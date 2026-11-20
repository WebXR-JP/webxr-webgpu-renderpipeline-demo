import * as THREE from 'three/webgpu';
import {
	Fn, vec2, vec3, vec4, float, uniform, attribute, color,
	positionGeometry, positionLocal, positionWorld, normalGeometry, uv,
	mix, smoothstep, step, abs, min, max, pow, exp, sin, fract, floor, length, normalize, clamp, dot,
	hash, time, mx_noise_float, fog, densityFogFactor, instancedBufferAttribute,
} from 'three/tsl';

import { U } from './params.js';

// Simple deterministic PRNG so the city looks the same every reload.
function mulberry32( seed ) {

	return function () {

		seed |= 0; seed = seed + 0x6D2B79F5 | 0;
		let t = Math.imul( seed ^ seed >>> 15, 1 | seed );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

const rand = mulberry32( 20261120 );
const rr = ( a, b ) => a + ( b - a ) * rand();

export const GATE_Z = - 30;

const PINK = new THREE.Color( 0xff3fc8 );
const MAGENTA = new THREE.Color( 0xc23dff );
const VIOLET = new THREE.Color( 0x7a3cff );
const BLUE = new THREE.Color( 0x4f6dff );
const ICE = new THREE.Color( 0x9fc0ff );

/**
 * Builds the neon city. Returns the scene plus a per-frame update function.
 */
export function createNeonCity() {

	const scene = new THREE.Scene();

	// Purple exponential fog: distant towers dissolve into the sky like in the reference image.
	const fogColor = uniform( new THREE.Color( 0x2b0f52 ) );
	scene.fogNode = fog( fogColor, densityFogFactor( U.fogDensity ) );

	scene.add( createSky() );

	const mirror = new THREE.Group();
	mirror.name = 'mirror-world';
	mirror.scale.y = - 1; // cheap planar reflection: the whole city mirrored below a translucent floor
	scene.add( mirror );

	const buildings = createBuildings();
	scene.add( buildings );
	const buildingsMirror = new THREE.InstancedMesh( buildings.geometry, buildings.material, buildings.count );
	buildingsMirror.instanceMatrix = buildings.instanceMatrix;
	buildingsMirror.frustumCulled = false;
	mirror.add( buildingsMirror );

	const gate = createNeonGate();
	scene.add( gate );
	const gateMirror = gate.clone();
	mirror.add( gateMirror );

	scene.add( createFloor() );
	scene.add( createRocks() );
	scene.add( createDust() );

	// Lighting: mostly from the neon gate, plus a dim violet sky fill.
	scene.add( new THREE.HemisphereLight( 0x6a3cff, 0x12051f, 0.9 ) );

	const moon = new THREE.DirectionalLight( 0xb08cff, 0.6 );
	moon.position.set( - 10, 30, 20 );
	scene.add( moon );

	const lights = [
		[ PINK, - 1.6, 3.5, 140 ],
		[ ICE, 0.2, 2.5, 105 ],
		[ BLUE, 1.8, 3.5, 140 ],
		[ MAGENTA, 0, 8, 105 ],
	];

	for ( const [ c, x, y, intensity ] of lights ) {

		const light = new THREE.PointLight( c, intensity, 0, 1.8 );
		light.position.set( x, y, GATE_Z + 1.2 );
		scene.add( light );

	}

	return { scene, fogColor };

}

// ---------------------------------------------------------------------------
// Sky: gradient dome + procedural twinkling stars with 4-point sparkles
// ---------------------------------------------------------------------------

function createSky() {

	const material = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide, depthWrite: false } );
	material.fog = false;

	material.colorNode = Fn( () => {

		const dir = normalize( positionLocal );
		const h = dir.y;

		const horizon = color( 0x4a1d86 );
		const mid = color( 0x1f0a44 );
		const zenith = color( 0x07021a );

		const sky = mix( horizon, mid, smoothstep( 0.0, 0.25, h ) ).toVar();
		sky.assign( mix( sky, zenith, smoothstep( 0.25, 0.9, h ) ) );

		// pink/violet haze behind the gate (gate is straight down -Z)
		const toGate = max( dot( dir, normalize( vec3( 0, 0.12, - 1 ) ) ), 0 );
		sky.addAssign( color( 0xb23cff ).mul( pow( toGate, 18 ) ).mul( 0.9 ) );
		sky.addAssign( color( 0xff4fd8 ).mul( pow( toGate, 80 ) ).mul( 0.8 ) );

		// stars: one candidate per 3D grid cell on the sphere
		const starField = ( scale, threshold, size ) => {

			const p = dir.mul( scale );
			const cell = floor( p );
			const f = fract( p ).sub( 0.5 );
			const seed = cell.x.add( cell.y.mul( 157.0 ) ).add( cell.z.mul( 113.0 ) );
			const h1 = hash( seed );
			const h2 = hash( seed.add( 19.19 ) );
			const offset = vec3( hash( seed.add( 3.1 ) ), hash( seed.add( 7.7 ) ), hash( seed.add( 11.3 ) ) ).sub( 0.5 ).mul( 0.6 );
			const d = f.sub( offset );
			const core = smoothstep( size, 0.0, length( d ) );
			const twinkle = sin( time.mul( h2.mul( 3.0 ).add( 1.0 ) ).add( h2.mul( 40.0 ) ) ).mul( 0.35 ).add( 0.65 );
			return step( threshold, h1 ).mul( core ).mul( twinkle );

		};

		const smallStars = starField( 90.0, 0.93, 0.09 );
		const bigStars = starField( 22.0, 0.975, 0.05 );

		// sparkle cross for the big ones
		const p = dir.mul( 22.0 );
		const f = fract( p ).sub( 0.5 );
		const cross = smoothstep( 0.012, 0.0, min( abs( f.x ), abs( f.y ) ) ).mul( smoothstep( 0.35, 0.0, length( f ) ) );
		const starAmount = smallStars.mul( 1.2 ).add( bigStars.mul( 6.0 ) ).add( cross.mul( bigStars.greaterThan( 0.0 ).select( 2.0, 0.0 ) ) );

		const aboveHorizon = smoothstep( - 0.02, 0.15, h );
		sky.addAssign( vec3( 0.85, 0.8, 1.0 ).mul( starAmount ).mul( aboveHorizon ).mul( U.starIntensity ) );

		return sky;

	} )();

	const mesh = new THREE.Mesh( new THREE.SphereGeometry( 600, 48, 24 ), material );
	mesh.frustumCulled = false;
	mesh.renderOrder = - 1;
	return mesh;

}

// ---------------------------------------------------------------------------
// Buildings: one InstancedMesh, stepped towers, glowing edges
// ---------------------------------------------------------------------------

function createBuildings() {

	const boxes = []; // { x, y, z, w, h, d, tint: Color, seed }

	const pushTower = ( x, z, w, d, h, tint ) => {

		const seed = rand();
		boxes.push( { x, y: h / 2, z, w, h, d, tint, seed } );

		// stepped tiers / thin spires, like the reference skyline
		if ( rand() < 0.55 ) {

			const h2 = h * rr( 0.25, 0.9 );
			const w2 = w * rr( 0.35, 0.7 );
			const d2 = d * rr( 0.35, 0.7 );
			boxes.push( { x: x + rr( - 0.2, 0.2 ) * w, y: h + h2 / 2, z: z + rr( - 0.2, 0.2 ) * d, w: w2, h: h2, d: d2, tint, seed: rand() } );

		}

		if ( rand() < 0.35 ) {

			// low step in front of the tower
			const h3 = h * rr( 0.08, 0.3 );
			boxes.push( { x: x + rr( - 0.6, 0.6 ), y: h3 / 2, z: z + rr( - 0.6, 0.6 ), w: w * rr( 0.8, 1.4 ), h: h3, d: d * rr( 0.8, 1.4 ), tint, seed: rand() } );

		}

	};

	for ( const side of [ - 1, 1 ] ) {

		for ( let z = 14; z > - 140; z -= rr( 1.6, 2.8 ) ) {

			for ( let row = 0; row < 7; row ++ ) {

				if ( rand() < 0.18 ) continue;

				const x = side * ( 5.0 + row * rr( 2.4, 3.4 ) + rr( 0, 1.2 ) );
				const w = rr( 0.9, 2.6 );
				const d = rr( 0.9, 2.6 );

				// inner rows are low and stepped, outer rows tower up
				let h = rr( 2, 7 ) + row * rr( 2.5, 6.5 );
				if ( rand() < 0.22 ) h *= rr( 1.6, 2.4 ); // occasional needle

				const t = rand();
				const tint = side < 0
					? PINK.clone().lerp( MAGENTA, t ).lerp( VIOLET, rand() * 0.4 )
					: BLUE.clone().lerp( ICE, t * 0.6 ).lerp( VIOLET, rand() * 0.5 );

				pushTower( x, z, w, d, h, tint );

			}

		}

	}

	// backdrop behind the gate
	for ( let z = GATE_Z - 7; z > - 150; z -= rr( 2.5, 4.5 ) ) {

		for ( let x = - 6; x <= 6; x += rr( 2.2, 3.6 ) ) {

			if ( rand() < 0.3 ) continue;
			const h = rr( 2, 10 ) + ( GATE_Z - z ) * rr( 0.05, 0.2 );
			const tint = x < 0 ? PINK.clone().lerp( VIOLET, rand() ) : BLUE.clone().lerp( VIOLET, rand() );
			pushTower( x, z, rr( 1, 2.5 ), rr( 1, 2.5 ), h, tint );

		}

	}

	const count = boxes.length;
	const geometry = new THREE.BoxGeometry( 1, 1, 1 );

	const scaleAttr = new Float32Array( count * 3 );
	const tintAttr = new Float32Array( count * 3 );
	const seedAttr = new Float32Array( count );

	const material = new THREE.MeshStandardNodeMaterial( { roughness: 0.32, metalness: 0.55 } );
	const mesh = new THREE.InstancedMesh( geometry, material, count );
	mesh.name = 'buildings';

	const m = new THREE.Matrix4();

	boxes.forEach( ( b, i ) => {

		m.makeScale( b.w, b.h, b.d ).setPosition( b.x, b.y, b.z );
		mesh.setMatrixAt( i, m );
		scaleAttr.set( [ b.w, b.h, b.d ], i * 3 );
		tintAttr.set( [ b.tint.r, b.tint.g, b.tint.b ], i * 3 );
		seedAttr[ i ] = b.seed;

	} );

	geometry.setAttribute( 'aScale', new THREE.InstancedBufferAttribute( scaleAttr, 3 ) );
	geometry.setAttribute( 'aTint', new THREE.InstancedBufferAttribute( tintAttr, 3 ) );
	geometry.setAttribute( 'aSeed', new THREE.InstancedBufferAttribute( seedAttr, 1 ) );

	const aScale = attribute( 'aScale', 'vec3' );
	const aTint = attribute( 'aTint', 'vec3' );
	const aSeed = attribute( 'aSeed', 'float' );

	// local metric coordinates of the fragment inside its box (meters, centered)
	const local = positionGeometry.mul( aScale );
	const half = aScale.mul( 0.5 );
	const heightT = positionGeometry.y.add( 0.5 ); // 0 bottom → 1 top

	material.colorNode = aTint.mul( 0.09 ).add( vec3( 0.025, 0.012, 0.05 ) );

	material.emissiveNode = Fn( () => {

		const n = normalGeometry;
		const onSideX = abs( n.x ).greaterThan( 0.5 );
		const onTop = abs( n.y ).greaterThan( 0.5 );

		// distance (m) to the face's own borders — never along the face normal
		const dX = half.x.sub( abs( local.x ) );
		const dZ = half.z.sub( abs( local.z ) );
		const dLateral = onTop.select( min( dX, dZ ), onSideX.select( dZ, dX ) ); // vertical edges / roof rim
		const dTop = onTop.select( float( 1e3 ), half.y.sub( local.y ) ); // top rim on side faces

		const edge = smoothstep( 0.06, 0.0, dLateral ).max( smoothstep( 0.06, 0.0, dTop ).mul( 1.4 ) );

		// a soft wash of light that grows towards the top, like the reference skyline
		const wash = pow( heightT, 3.0 ).mul( 0.05 );

		// some towers carry vertical neon strips on their faces
		const lateral = abs( n.x ).greaterThan( 0.5 ).select( local.z, local.x );
		const stripCount = floor( aSeed.mul( 3.0 ) ).add( 2.0 );
		const strip = smoothstep( 0.035, 0.0, abs( fract( lateral.mul( stripCount ).div( 2.0 ) ).sub( 0.5 ) ) )
			.mul( step( 0.88, aSeed ) )
			.mul( step( 0.5, abs( n.y ).oneMinus() ) );
		const stripPulse = sin( time.mul( U.neonSpeed ).mul( 1.3 ).add( aSeed.mul( 50.0 ) ).add( heightT.mul( 3.0 ) ) ).mul( 0.4 ).add( 0.6 );

		const glow = edge.mul( mix( 0.35, 1.6, heightT ) ).add( wash ).mul( U.edgeGlow ).add( strip.mul( stripPulse ).mul( 2.5 ) );

		return aTint.mul( glow );

	} )();

	return mesh;

}

// ---------------------------------------------------------------------------
// Neon gate: vertical light tubes + haze
// ---------------------------------------------------------------------------

function createNeonGate() {

	const group = new THREE.Group();
	group.name = 'neon-gate';

	const tubes = [
		{ x: - 2.3, h: 8.2, c: ICE },
		{ x: - 1.7, h: 9.0, c: new THREE.Color( 0xb9c8ff ) },
		{ x: - 1.05, h: 8.6, c: MAGENTA },
		{ x: - 0.45, h: 9.4, c: new THREE.Color( 0xff8fe6 ) },
		{ x: 0.2, h: 8.8, c: PINK },
		{ x: 0.85, h: 9.2, c: new THREE.Color( 0xffc4f2 ) },
		{ x: 1.5, h: 8.4, c: PINK },
		{ x: 2.2, h: 9.0, c: new THREE.Color( 0xff2fb0 ) },
	];

	const geometry = new THREE.CylinderGeometry( 0.075, 0.075, 1, 12, 1 );

	tubes.forEach( ( t, i ) => {

		const material = new THREE.MeshBasicNodeMaterial();
		const phase = float( i * 1.37 );

		material.colorNode = Fn( () => {

			const speed = U.neonSpeed;
			const pulse = sin( time.mul( speed ).mul( 1.7 ).add( phase ) ).mul( 0.12 ).add( 0.88 );
			// occasional flicker
			const tick = floor( time.mul( speed ).mul( 14.0 ) );
			const flicker = step( 0.985, hash( tick.add( phase.mul( 31.0 ) ) ) ).mul( 0.75 ).oneMinus();
			// hot white core along the tube, a bit brighter near the middle
			const v = uv().y;
			const along = smoothstep( 0.0, 0.08, v ).mul( smoothstep( 1.0, 0.92, v ) );
			return color( t.c ).mul( U.neonIntensity ).mul( pulse ).mul( flicker ).mul( along.mul( 0.8 ).add( 0.2 ) );

		} )();

		const tube = new THREE.Mesh( geometry, material );
		tube.scale.y = t.h;
		tube.position.set( t.x, 0.35 + t.h / 2, GATE_Z );
		group.add( tube );

	} );

	// soft glow card behind the tubes
	const hazeMaterial = new THREE.MeshBasicNodeMaterial( {
		transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
	} );
	hazeMaterial.fog = false;
	hazeMaterial.colorNode = Fn( () => {

		const p = uv().sub( vec2( 0.5, 0.42 ) ).mul( vec2( 1.5, 1.0 ) );
		const d = length( p );
		const core = exp( d.mul( d ).mul( - 14.0 ) );
		const wide = exp( d.mul( d ).mul( - 4.0 ) );
		const c = mix( color( 0x7a3cff ), color( 0xff4fd8 ), core );
		return c.mul( wide.mul( 0.35 ).add( core.mul( 0.5 ) ) ).mul( U.neonIntensity.div( 9.0 ) );

	} )();

	const haze = new THREE.Mesh( new THREE.PlaneGeometry( 16, 18 ), hazeMaterial );
	haze.position.set( 0, 6.5, GATE_Z - 1.0 );
	group.add( haze );

	return group;

}

// ---------------------------------------------------------------------------
// Floor: dark glossy tiles, translucent so the mirrored city reads as reflection
// ---------------------------------------------------------------------------

function createFloor() {

	const material = new THREE.MeshStandardNodeMaterial( { transparent: true, depthWrite: true } );

	const tileSize = 2.0;
	const p = positionWorld.xz.div( tileSize );
	const f = abs( fract( p ).sub( 0.5 ) );
	const line = smoothstep( 0.475, 0.497, max( f.x, f.y ) );
	const tileId = floor( p );
	const tileHash = hash( tileId.x.add( tileId.y.mul( 91.7 ) ) );
	const wet = mx_noise_float( positionWorld.xz.mul( 0.22 ) ).mul( 0.5 ).add( 0.5 );

	material.colorNode = mix( vec3( 0.03, 0.016, 0.055 ), vec3( 0.075, 0.045, 0.12 ), line ).add( tileHash.mul( 0.012 ) );
	material.roughnessNode = clamp( wet.mul( 0.35 ).add( 0.08 ).add( line.mul( 0.4 ) ), 0.05, 1.0 );
	material.metalnessNode = float( 0.35 );
	material.emissiveNode = vec3( 0.06, 0.025, 0.11 ).mul( line ).mul( U.edgeGlow );
	// lower opacity = stronger "reflection" of the mirrored world below
	material.opacityNode = clamp( wet.mul( 0.25 ).add( 0.62 ).add( line.mul( 0.3 ) ), 0, 1 );

	const floor_ = new THREE.Mesh( new THREE.PlaneGeometry( 500, 500 ), material );
	floor_.rotation.x = - Math.PI / 2;
	floor_.name = 'floor';
	return floor_;

}

// ---------------------------------------------------------------------------
// Rocks scattered on the floor
// ---------------------------------------------------------------------------

function createRocks() {

	const count = 260;
	const geometry = new THREE.IcosahedronGeometry( 1, 0 );
	const material = new THREE.MeshStandardNodeMaterial( { color: 0x2a2236, roughness: 0.85, metalness: 0.15, flatShading: true } );
	const mesh = new THREE.InstancedMesh( geometry, material, count );
	mesh.name = 'rocks';

	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const e = new THREE.Euler();
	const s = new THREE.Vector3();
	const pos = new THREE.Vector3();

	let i = 0;

	while ( i < count ) {

		const x = rr( - 9, 9 );
		const z = rr( 8, GATE_Z + 2 );
		if ( Math.hypot( x, z ) < 1.6 ) continue; // keep the player's spot clear

		const big = rand() < 0.15;
		const base = big ? rr( 0.25, 0.55 ) : rr( 0.05, 0.22 );
		s.set( base * rr( 0.8, 1.6 ), base * rr( 0.45, 0.85 ), base * rr( 0.8, 1.6 ) );
		e.set( rand() * 6.28, rand() * 6.28, rand() * 6.28 );
		q.setFromEuler( e );
		pos.set( x, s.y * 0.35, z );
		m.compose( pos, q, s );
		mesh.setMatrixAt( i, m );
		i ++;

	}

	return mesh;

}

// ---------------------------------------------------------------------------
// Slowly rising glowing dust specks (tiny instanced quads)
// ---------------------------------------------------------------------------

function createDust() {

	const count = 500;
	const seeds = new Float32Array( count * 4 );

	for ( let i = 0; i < count; i ++ ) {

		seeds.set( [ rr( - 12, 12 ), rr( 0, 14 ), rr( GATE_Z - 4, 10 ), rand() ], i * 4 );

	}

	const material = new THREE.SpriteNodeMaterial( {
		transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
	} );

	const a = instancedBufferAttribute( new THREE.InstancedBufferAttribute( seeds, 4 ) );
	const t = time.mul( 0.15 ).add( a.w.mul( 100.0 ) );
	const y = fract( a.y.div( 14.0 ).add( t.mul( 0.08 ) ) ).mul( 14.0 );
	material.positionNode = vec3(
		a.x.add( sin( t.mul( 1.3 ).add( a.w.mul( 20.0 ) ) ).mul( 0.4 ) ),
		y,
		a.z.add( sin( t.add( a.w.mul( 9.0 ) ) ).mul( 0.4 ) )
	);
	material.scaleNode = float( 0.025 ).mul( a.w.add( 0.6 ) );
	const d = length( uv().sub( 0.5 ) );
	const tint = mix( color( 0xff4fd8 ), color( 0x7f9bff ), a.w );
	material.colorNode = vec4( tint.mul( 2.5 ), smoothstep( 0.5, 0.0, d ).mul( smoothstep( 0.0, 1.5, y ) ) );

	const sprites = new THREE.Sprite( material );
	sprites.count = count;
	sprites.frustumCulled = false;
	return sprites;

}
