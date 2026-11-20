import * as THREE from 'three/webgpu';
import { texture, uv, vec2, fract, step, mix } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { params, DEFAULTS, GROUPS, PRESETS } from './params.js';
import { createNeonCity, GATE_Z } from './scene.js';
import { PipelineLab } from './pipeline.js';
import { VRPanel } from './vrPanel.js';

const statusEl = document.getElementById( 'status' );

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGPURenderer( { antialias: false } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = params.toneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.appendChild( renderer.domElement );

await renderer.init();

const isWebGPU = renderer.backend.isWebGPUBackend === true;
const hasXRGPUBinding = typeof globalThis.XRGPUBinding !== 'undefined';

statusEl.innerHTML = [
	`Backend: <b class="${ isWebGPU ? 'ok' : 'ng' }">${ isWebGPU ? 'WebGPU' : 'WebGL2 (fallback)' }</b>`,
	`XRGPUBinding: <b class="${ hasXRGPUBinding ? 'ok' : 'ng' }">${ hasXRGPUBinding ? 'available' : 'not available' }</b>`,
].join( ' &nbsp;·&nbsp; ' );

// ---------------------------------------------------------------------------
// Scene + player rig
// ---------------------------------------------------------------------------

const { scene } = createNeonCity();

const rig = new THREE.Group();
rig.name = 'player-rig';
scene.add( rig );

const camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.05, 1500 );
camera.position.set( 0, 1.6, 2.4 );
rig.add( camera );

// UI lives in its own scene and is drawn *after* post-processing (see renderOverlay).
const uiScene = new THREE.Scene();
const uiRig = new THREE.Group();
uiScene.add( uiRig );

// ---------------------------------------------------------------------------
// Post-processing lab + parameter plumbing
// ---------------------------------------------------------------------------

const lab = new PipelineLab( renderer, scene );

const panel = new VRPanel( { onChange: setParam, onPreset: applyPreset } );
panel.mesh.position.set( - 0.85, 1.35, - 0.55 );
panel.mesh.lookAt( 0, 1.5, 1.4 );
uiScene.add( panel.mesh );

function setParam( key, value ) {

	if ( params[ key ] === value ) return;
	params[ key ] = value;
	lab.onParamChanged( key );
	panel.dirty = true;

}

function applyPreset( index ) {

	const keep = { msaa: params.msaa, renderScale: params.renderScale };
	const next = { ...DEFAULTS, ...PRESETS[ index ].values, ...keep };
	for ( const key of Object.keys( next ) ) setParam( key, next[ key ] );

}

// ---------------------------------------------------------------------------
// Desktop GUI (lil-gui) — mirrors the VR panel
// ---------------------------------------------------------------------------

const gui = new GUI( { title: 'RenderPipeline Lab', width: 300 } );
const view = { stereoPreview: false, showPanel: true };

// lil-gui writes into `params` itself, so its callbacks only need to propagate the change.
const onGuiChange = ( key ) => () => {

	lab.onParamChanged( key );
	panel.dirty = true;

};

gui.add( params, 'bypass' ).name( 'Bypass post (raw)' ).listen().onChange( onGuiChange( 'bypass' ) );

const presetFolder = gui.addFolder( 'Presets' );
PRESETS.forEach( ( preset, i ) => presetFolder.add( { apply: () => applyPreset( i ) }, 'apply' ).name( preset.name ) );

for ( const group of GROUPS ) {

	const folder = gui.addFolder( group.label );
	folder.close();

	const bind = ( ctrl, key ) => ctrl.listen().onChange( onGuiChange( key ) );

	if ( group.toggle ) bind( folder.add( params, group.toggle ).name( 'Enabled' ), group.toggle );

	for ( const item of group.items ) {

		if ( item.type === 'bool' ) bind( folder.add( params, item.key ).name( item.label ), item.key );
		else if ( item.type === 'select' ) bind( folder.add( params, item.key, Object.fromEntries( item.options ) ).name( item.label ), item.key );
		else bind( folder.add( params, item.key, item.min, item.max, item.step ).name( item.label ), item.key );

	}

}

const viewFolder = gui.addFolder( 'Desktop view' );
viewFolder.add( view, 'stereoPreview' ).name( 'Stereo preview (XR path)' );
viewFolder.add( view, 'showPanel' ).name( 'Show VR panel' ).onChange( ( v ) => ( panel.mesh.visible = v ) );

// ---------------------------------------------------------------------------
// Desktop controls + mouse interaction with the VR panel
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function mouseHit( event ) {

	ndc.set( ( event.clientX / window.innerWidth ) * 2 - 1, - ( event.clientY / window.innerHeight ) * 2 + 1 );
	raycaster.setFromCamera( ndc, camera );
	return panel.intersect( raycaster.ray );

}

// registered before OrbitControls so we can swallow clicks that land on the panel
renderer.domElement.addEventListener( 'pointerdown', ( event ) => {

	if ( renderer.xr.isPresenting || view.stereoPreview ) return;
	if ( panel.pointerDown( 'mouse', mouseHit( event ) ) ) {

		event.stopImmediatePropagation();
		renderer.domElement.setPointerCapture( event.pointerId );

	}

} );

renderer.domElement.addEventListener( 'pointermove', ( event ) => {

	if ( renderer.xr.isPresenting || view.stereoPreview ) return;
	panel.pointerMove( 'mouse', mouseHit( event ) );
	if ( panel.isDragging( 'mouse' ) ) event.stopImmediatePropagation();

} );

renderer.domElement.addEventListener( 'pointerup', () => panel.pointerUp( 'mouse' ) );

const controls = new OrbitControls( camera, renderer.domElement );
controls.target.set( 0, 2.6, - 8 );
controls.enableDamping = true;
controls.maxDistance = 40;
controls.update();

// ---------------------------------------------------------------------------
// XR controllers: rays + cursor in the UI scene, controller models in the world
// ---------------------------------------------------------------------------

const controllerModelFactory = new XRControllerModelFactory();
const rayGeometry = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 0, - 1 ) ] );

function makeUIMaterial( Material, r, g, b, options = {} ) {

	// raw display-referred color (see VRPanel docs)
	const material = new Material( { transparent: true, depthTest: false, depthWrite: false, ...options } );
	material.color.setRGB( r, g, b, THREE.LinearSRGBColorSpace );
	material.fog = false;
	material.toneMapped = false;
	return material;

}

const controllers = [ 0, 1 ].map( ( i ) => {

	const controller = renderer.xr.getController( i );
	controller.userData.id = 'xr' + i;
	uiRig.add( controller );

	const ray = new THREE.Line( rayGeometry, makeUIMaterial( THREE.LineBasicNodeMaterial, 1.0, 0.45, 0.9 ) );
	ray.scale.z = 3;
	ray.renderOrder = 11;
	ray.visible = false;
	controller.add( ray );

	const cursor = new THREE.Mesh( new THREE.RingGeometry( 0.006, 0.013, 24 ), makeUIMaterial( THREE.MeshBasicNodeMaterial, 1, 1, 1 ) );
	cursor.renderOrder = 12;
	cursor.visible = false;
	uiScene.add( cursor );

	controller.userData.ray = ray;
	controller.userData.cursor = cursor;
	controller.userData.inputSource = null;

	controller.addEventListener( 'connected', ( event ) => {

		controller.userData.inputSource = event.data;
		ray.visible = event.data.targetRayMode === 'tracked-pointer';

	} );

	controller.addEventListener( 'disconnected', () => {

		controller.userData.inputSource = null;
		ray.visible = false;
		cursor.visible = false;
		panel.pointerUp( controller.userData.id );

	} );

	controller.addEventListener( 'selectstart', () => {

		panel.pointerDown( controller.userData.id, controllerHit( controller ) );

	} );

	controller.addEventListener( 'selectend', () => panel.pointerUp( controller.userData.id ) );

	controller.addEventListener( 'squeezestart', () => summonPanel() );

	const grip = renderer.xr.getControllerGrip( i );
	grip.add( controllerModelFactory.createControllerModel( grip ) );
	rig.add( grip );

	return controller;

} );

const _rotation = new THREE.Matrix4();
const _ray = new THREE.Ray();

function controllerHit( controller ) {

	controller.updateWorldMatrix( true, false );
	_rotation.identity().extractRotation( controller.matrixWorld );
	_ray.origin.setFromMatrixPosition( controller.matrixWorld );
	_ray.direction.set( 0, 0, - 1 ).applyMatrix4( _rotation );
	return panel.intersect( _ray );

}

const _head = new THREE.Vector3();
const _forward = new THREE.Vector3();

/** Squeeze: bring the panel in front of the user. */
function summonPanel() {

	camera.getWorldPosition( _head );
	camera.getWorldDirection( _forward );
	_forward.y = 0;
	_forward.normalize();
	panel.mesh.position.copy( _head ).addScaledVector( _forward, 0.75 );
	panel.mesh.position.y -= 0.2;
	panel.mesh.lookAt( _head );
	panel.mesh.visible = true;

}

function updateControllers() {

	uiRig.position.copy( rig.position );
	uiRig.quaternion.copy( rig.quaternion );
	uiScene.updateMatrixWorld();

	for ( const controller of controllers ) {

		const { ray, cursor, inputSource, id } = controller.userData;

		if ( ! inputSource || inputSource.targetRayMode !== 'tracked-pointer' ) {

			cursor.visible = false;
			continue;

		}

		const hit = controllerHit( controller );
		const onPanel = hit !== null && hit.inside && hit.distance < 8;

		panel.pointerMove( id, onPanel || panel.isDragging( id ) ? hit : null );

		ray.scale.z = onPanel ? hit.distance : 3;
		cursor.visible = onPanel;

		if ( onPanel ) {

			cursor.position.copy( hit.point );
			cursor.quaternion.copy( panel.mesh.quaternion );

		}

	}

}

// Thumbstick locomotion: left stick moves, right stick snap-turns.
let snapReady = true;
const _move = new THREE.Vector3();
const _up = new THREE.Vector3( 0, 1, 0 );

function updateLocomotion( dt ) {

	const session = renderer.xr.getSession();
	if ( ! session ) return;

	for ( const source of session.inputSources ) {

		const gp = source.gamepad;
		if ( ! gp || gp.axes.length < 4 ) continue;

		const x = gp.axes[ 2 ], y = gp.axes[ 3 ];

		if ( source.handedness === 'left' ) {

			if ( Math.hypot( x, y ) < 0.15 ) continue;
			camera.getWorldDirection( _forward );
			_forward.y = 0;
			_forward.normalize();
			const right = _move.crossVectors( _forward, _up ).normalize().clone();
			rig.position.addScaledVector( _forward, - y * dt * 3.0 );
			rig.position.addScaledVector( right, x * dt * 3.0 );

		} else if ( source.handedness === 'right' ) {

			if ( Math.abs( x ) > 0.7 && snapReady ) {

				const angle = - Math.sign( x ) * Math.PI / 6;
				camera.getWorldPosition( _head );
				rig.position.sub( _head ).applyAxisAngle( _up, angle ).add( _head );
				rig.rotateY( angle );
				snapReady = false;

			} else if ( Math.abs( x ) < 0.3 ) {

				snapReady = true;

			}

		}

	}

}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Draws the UI scene on top of whatever target is currently bound, without any color transform. */
function renderOverlay( cam ) {

	const toneMapping = renderer.toneMapping;
	const colorSpace = renderer.outputColorSpace;
	const autoClear = renderer.autoClear;

	renderer.toneMapping = THREE.NoToneMapping;
	renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
	renderer.autoClear = false;

	renderer.render( uiScene, cam );

	renderer.toneMapping = toneMapping;
	renderer.outputColorSpace = colorSpace;
	renderer.autoClear = autoClear;

}

// Stereo preview: runs the exact XR code path (per-eye pipelines → array layers) on desktop.
const stereoTarget = new THREE.RenderTarget( 1, 1, { depth: 2, depthBuffer: false, type: THREE.UnsignedByteType } );
stereoTarget.texture.isArrayTexture = true;

const previewCameras = [ new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera() ];
const _eyeOffset = new THREE.Matrix4();

const stereoQuad = ( () => {

	const material = new THREE.MeshBasicNodeMaterial();
	const side = step( 0.5, uv().x );
	const eyeUV = vec2( fract( uv().x.mul( 2.0 ) ), uv().y );
	const left = texture( stereoTarget.texture, eyeUV ).depth( 0 );
	const right = texture( stereoTarget.texture, eyeUV ).depth( 1 );
	material.colorNode = mix( left, right, side );
	return new THREE.QuadMesh( material );

} )();

const _size = new THREE.Vector2();

function renderStereoPreview() {

	renderer.getDrawingBufferSize( _size );
	const eyeW = Math.max( 1, Math.floor( _size.x / 2 ) );
	const eyeH = Math.max( 1, _size.y );

	if ( stereoTarget.width !== eyeW || stereoTarget.height !== eyeH ) stereoTarget.setSize( eyeW, eyeH, 2 );

	camera.updateMatrixWorld();

	previewCameras.forEach( ( cam, i ) => {

		cam.fov = camera.fov;
		cam.near = camera.near;
		cam.far = camera.far;
		cam.aspect = eyeW / eyeH;
		cam.updateProjectionMatrix();
		cam.matrixWorld.copy( camera.matrixWorld ).multiply( _eyeOffset.makeTranslation( i === 0 ? - 0.032 : 0.032, 0, 0 ) );
		cam.matrixWorldInverse.copy( cam.matrixWorld ).invert();

	} );

	lab.renderStereo( stereoTarget, previewCameras, eyeW, eyeH, ( eye ) => renderOverlay( eye ) );

	const toneMapping = renderer.toneMapping;
	const colorSpace = renderer.outputColorSpace;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
	stereoQuad.render( renderer );
	renderer.toneMapping = toneMapping;
	renderer.outputColorSpace = colorSpace;

}

let sRGBFormatWarned = false;

function renderXR() {

	// Resolve the XR view cameras relative to the rig, then render each eye ourselves.
	renderer.xr.updateCamera( camera );
	const xrCamera = renderer.xr.getCamera();
	const target = renderer.getOutputRenderTarget();

	if ( ! target || xrCamera.cameras.length === 0 ) return;

	if ( ! sRGBFormatWarned ) {

		const format = renderer.backend.get( target.texture ).format;
		console.info( '[XR] projection layer', target.width + 'x' + target.height, 'format:', format, 'views:', xrCamera.cameras.length );
		sRGBFormatWarned = true;

	}

	lab.renderStereo( target, xrCamera.cameras, target.width, target.height, ( eye ) => renderOverlay( eye ) );

}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

const timer = new THREE.Timer();
let fpsAccum = 0, fpsFrames = 0;

renderer.setAnimationLoop( ( timestamp ) => {

	timer.update( timestamp );
	const dt = Math.min( timer.getDelta(), 0.1 );

	fpsAccum += dt;
	fpsFrames ++;

	if ( fpsAccum > 0.5 ) {

		panel.fps = fpsFrames / fpsAccum;
		panel.status = renderer.xr.isPresenting ? '· WebGPU XR' : isWebGPU ? '· WebGPU' : '· WebGL2';
		panel.dirty = true;
		fpsAccum = 0;
		fpsFrames = 0;

	}

	if ( renderer.xr.isPresenting ) {

		updateLocomotion( dt );
		updateControllers();
		panel.update();
		renderXR();

	} else {

		controls.update();
		uiScene.updateMatrixWorld();
		panel.update();

		if ( view.stereoPreview ) {

			renderStereoPreview();

		} else {

			lab.render( camera );
			renderOverlay( camera );

		}

	}

} );

// ---------------------------------------------------------------------------
// XR session / resize
// ---------------------------------------------------------------------------

renderer.xr.addEventListener( 'sessionstart', () => {

	// stand in the corridor facing the gate, panel to the left
	camera.position.set( 0, 0, 0 );
	camera.quaternion.identity();
	rig.position.set( 0, 0, 0 );
	rig.quaternion.identity();
	panel.mesh.position.set( - 0.75, 1.25, - 0.7 );
	panel.mesh.lookAt( 0, 1.5, 0 );
	panel.mesh.visible = true;

} );

renderer.xr.addEventListener( 'sessionend', () => {

	rig.position.set( 0, 0, 0 );
	rig.quaternion.identity();
	camera.position.set( 0, 1.6, 2.4 );
	controls.target.set( 0, 2.6, - 8 );
	controls.update();
	panel.mesh.position.set( - 0.85, 1.35, - 0.55 );
	panel.mesh.lookAt( 0, 1.5, 1.4 );

} );

// The WebGPU XR path requires the 'webgpu' session feature (XRGPUBinding).
const vrButton = VRButton.createButton( renderer, { requiredFeatures: [ 'webgpu' ] } );
document.body.appendChild( vrButton );

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

// handy for debugging from the console
Object.assign( window, { THREE, renderer, scene, camera, lab, panel, params, setParam, GATE_Z } );
