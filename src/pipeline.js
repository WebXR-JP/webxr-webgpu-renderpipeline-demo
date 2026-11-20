import * as THREE from 'three/webgpu';
import { pass, renderOutput, vec2, vec4, float, pow, max, saturation, hue } from 'three/tsl';

import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { scanlines, vignette } from 'three/addons/tsl/display/CRT.js';

import { params, U, GRAPH_KEYS } from './params.js';

/**
 * Owns one RenderPipeline (+ its node graph) per camera.
 *
 * Why several pipelines?
 * In a WebGPU XR session three.js renders into an XR projection layer that is a
 * 2-layer texture array (one layer per eye, via XRGPUBinding). The stock
 * PassNode/RenderPipeline is not array-aware yet: the scene pass would draw both
 * eyes into one 2D target and the final quad would only reach layer 0.
 * So we run a complete, independent post-processing chain per eye with a regular
 * PerspectiveCamera that mirrors the XR view, and blit each result into its
 * array layer with `renderer.setRenderTarget( xrTarget, eyeIndex )`.
 * Nodes such as Bloom/AfterImage update once per frame (NodeUpdateType.FRAME),
 * which is another reason each eye needs its own instances.
 */
export class PipelineLab {

	constructor( renderer, scene ) {

		this.renderer = renderer;
		this.scene = scene;
		this.chains = new Map();
		this.graphVersion = 0;

		// Cameras that follow the XR views (or the stereo preview).
		this.eyeCameras = [ 0, 1 ].map( ( i ) => {

			const cam = new THREE.PerspectiveCamera();
			cam.name = 'eye-' + i;
			cam.matrixAutoUpdate = false;
			cam.matrixWorldAutoUpdate = false;
			return cam;

		} );

		this._forcedSize = new THREE.Vector2();
		this._forcedGetDBS = ( target ) => target.copy( this._forcedSize );

	}

	/** Returns (and lazily creates) the post chain for a camera. */
	getChain( camera ) {

		let chain = this.chains.get( camera );

		if ( chain === undefined ) {

			chain = this._createChain( camera );
			this.chains.set( camera, chain );

		}

		if ( chain.version !== this.graphVersion ) this._applyGraph( chain );

		return chain;

	}

	_createChain( camera ) {

		const scenePass = pass( this.scene, camera, { samples: params.msaa ? 4 : 0 } );
		scenePass.setResolutionScale( params.renderScale );

		const sceneColor = scenePass.getTextureNode( 'output' );

		const bloomNode = bloom( sceneColor, U.bloomStrength, U.bloomRadius, U.bloomThreshold );

		const flareNode = lensflare( bloomNode.getTextureNode(), {
			threshold: U.flareThreshold,
			ghostSpacing: U.flareSpacing,
			ghostAttenuationFactor: U.flareAttenuation,
			ghostTint: new THREE.Color( 1.0, 0.75, 1.0 ),
		} );

		const trailNode = afterImage( sceneColor, U.trailDamp );

		const pipeline = new THREE.RenderPipeline( this.renderer );
		// We place renderOutput() ourselves so FXAA / grain / scanlines run on display-referred color.
		pipeline.outputColorTransform = false;

		return {
			camera, pipeline, scenePass, sceneColor, bloomNode, flareNode, trailNode,
			memo: new Map(), version: - 1,
		};

	}

	_memo( chain, key, factory ) {

		let node = chain.memo.get( key );
		if ( node === undefined ) {

			node = factory();
			chain.memo.set( key, node );

		}

		return node;

	}

	_buildOutputNode( chain ) {

		const p = params;

		if ( p.bypass ) return renderOutput( chain.sceneColor );

		// 1) HDR stage --------------------------------------------------------
		const base = p.trailEnabled ? chain.trailNode.getTextureNode() : chain.sceneColor;

		const lensed = p.chromaEnabled
			? this._memo( chain, 'ca:' + p.trailEnabled, () => chromaticAberration( base, U.chromaStrength, vec2( 0.5 ), U.chromaScale ) )
			: base;

		let hdr = lensed.rgb;

		if ( p.bloomEnabled ) hdr = hdr.add( chain.bloomNode.rgb );
		if ( p.flareEnabled ) hdr = hdr.add( chain.flareNode.rgb.mul( U.flareIntensity ) );

		// 2) grading (scene-referred) ----------------------------------------
		hdr = hdr.mul( U.exposure );
		hdr = pow( max( hdr.div( 0.18 ), 0.0 ), U.contrast ).mul( 0.18 );
		hdr = saturation( hdr, U.saturation );
		hdr = hue( hdr, U.hue );

		// 3) tone mapping + sRGB ---------------------------------------------
		let ldr = renderOutput( vec4( hdr, 1.0 ) );

		if ( p.fxaaEnabled ) {

			const sig = [ p.trailEnabled, p.chromaEnabled, p.bloomEnabled, p.flareEnabled ].map( Number ).join( '' );
			const src = ldr;
			ldr = this._memo( chain, 'fxaa:' + sig, () => fxaa( src ) );

		}

		// 4) display-referred overlays ---------------------------------------
		let rgb = ldr.rgb;

		if ( p.vignetteEnabled ) rgb = vignette( rgb, U.vignetteIntensity, U.vignetteSmoothness );
		if ( p.scanEnabled ) rgb = scanlines( rgb, U.scanIntensity, U.scanCount, U.scanSpeed );
		if ( p.filmEnabled ) rgb = film( vec4( rgb, 1.0 ), U.filmIntensity ).rgb;

		return vec4( rgb, float( 1.0 ) );

	}

	_applyGraph( chain ) {

		const samples = params.msaa ? 4 : 0;

		if ( chain.scenePass.options.samples !== samples ) {

			chain.scenePass.options.samples = samples;
			chain.scenePass.renderTarget.samples = samples;
			chain.scenePass.renderTarget.dispose(); // force re-allocation with the new sample count

		}

		chain.pipeline.outputNode = this._buildOutputNode( chain );
		chain.pipeline.needsUpdate = true;
		chain.version = this.graphVersion;

	}

	/** Called whenever a param changes. */
	onParamChanged( key ) {

		const value = params[ key ];

		if ( U[ key ] !== undefined ) U[ key ].value = value;

		if ( key === 'toneMapping' ) {

			// RenderPipeline notices the renderer's tone mapping change and rebuilds itself.
			this.renderer.toneMapping = value;

		} else if ( key === 'renderScale' ) {

			for ( const chain of this.chains.values() ) chain.scenePass.setResolutionScale( value );

		} else if ( GRAPH_KEYS.has( key ) ) {

			this.graphVersion ++;

		}

	}

	/** Normal desktop rendering to the canvas. */
	render( camera ) {

		this.getChain( camera ).pipeline.render();

	}

	/**
	 * Renders each eye through its own pipeline into layer `i` of an array render target.
	 *
	 * @param {RenderTarget} target - XR projection layer target (or any 2-layer array RT)
	 * @param {Array<Camera>} sourceCameras - cameras providing matrixWorld + projection per eye
	 * @param {number} width - per-eye width in pixels
	 * @param {number} height - per-eye height in pixels
	 * @param {?Function} overlay - called per eye after post-processing, e.g. for UI
	 */
	renderStereo( target, sourceCameras, width, height, overlay = null ) {

		const renderer = this.renderer;

		const prevOutputTarget = renderer.getOutputRenderTarget();
		const prevTarget = renderer.getRenderTarget();
		const prevFace = renderer.getActiveCubeFace();
		const prevMip = renderer.getActiveMipmapLevel();

		// Treat the XR layer as a plain render target so passes don't swap in the XR ArrayCamera,
		// and make every effect size its buffers to one eye instead of the (unrelated) canvas.
		renderer.setOutputRenderTarget( null );
		this._forcedSize.set( width, height );
		renderer.getDrawingBufferSize = this._forcedGetDBS;

		try {

			for ( let i = 0; i < sourceCameras.length; i ++ ) {

				const src = sourceCameras[ i ];
				const eye = this.eyeCameras[ i ];

				eye.matrixWorld.copy( src.matrixWorld );
				eye.matrixWorldInverse.copy( src.matrixWorldInverse );
				eye.matrixWorld.decompose( eye.position, eye.quaternion, eye.scale );
				eye.projectionMatrix.copy( src.projectionMatrix );
				eye.projectionMatrixInverse.copy( src.projectionMatrixInverse );
				eye.near = src.near;
				eye.far = src.far;
				eye.layers.mask = src.layers.mask;

				const chain = this.getChain( eye );

				renderer.setRenderTarget( target, i );
				chain.pipeline.render();

				if ( overlay !== null ) overlay( eye, i );

			}

		} finally {

			delete renderer.getDrawingBufferSize; // back to the prototype implementation
			renderer.setRenderTarget( prevTarget, prevFace, prevMip );
			renderer.setOutputRenderTarget( prevOutputTarget );

		}

	}

}
