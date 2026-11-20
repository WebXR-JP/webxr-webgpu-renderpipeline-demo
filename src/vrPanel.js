import * as THREE from 'three/webgpu';

import { GROUPS, PRESETS, params } from './params.js';

const W = 1024;
const H = 680;
const PANEL_WIDTH = 1.05; // meters
const PANEL_HEIGHT = PANEL_WIDTH * H / W;

const COL = {
	bg: 'rgba(16, 6, 34, 0.9)',
	border: '#ff4fd8',
	text: '#f3e9ff',
	dim: '#9b86c9',
	accent: '#ff4fd8',
	accent2: '#7f9bff',
	track: '#2c1752',
	hover: 'rgba(255, 79, 216, 0.18)',
	on: '#ff4fd8',
	off: '#3a2566',
};

/**
 * World-space control panel drawn into a CanvasTexture.
 * Pointer input (XR controller rays or desktop mouse) is given as panel UV coordinates.
 *
 * The texture is tagged NoColorSpace and the panel is rendered in an overlay pass
 * straight into the (already tone-mapped, sRGB) output, so canvas colors land 1:1
 * and the UI is never blurred by bloom / aberration.
 */
export class VRPanel {

	constructor( { onChange, onPreset } ) {

		this.onChange = onChange;
		this.onPreset = onPreset;

		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = W;
		this.canvas.height = H;
		this.ctx = this.canvas.getContext( '2d' );

		this.texture = new THREE.CanvasTexture( this.canvas );
		this.texture.colorSpace = THREE.NoColorSpace;
		this.texture.anisotropy = 8;

		const material = new THREE.MeshBasicNodeMaterial( {
			map: this.texture, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
		} );
		material.fog = false;
		material.toneMapped = false;

		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( PANEL_WIDTH, PANEL_HEIGHT ), material );
		this.mesh.name = 'vr-panel';
		this.mesh.renderOrder = 10;

		this.activeGroup = 0;
		this.widgets = [];
		this.hover = new Map(); // pointerId -> widget
		this.drags = new Map(); // pointerId -> slider widget
		this.fps = 0;
		this.status = '';
		this.dirty = true;

		this._inverse = new THREE.Matrix4();
		this._ray = new THREE.Ray();
		this._plane = new THREE.Plane( new THREE.Vector3( 0, 0, 1 ), 0 );
		this._hit = new THREE.Vector3();

		this.redraw();

	}

	// -------------------------------------------------------------------------
	// Ray → UV
	// -------------------------------------------------------------------------

	/**
	 * Intersects a world-space ray with the (infinite) panel plane.
	 * Returns { uv, point, distance, inside } or null when pointing away.
	 */
	intersect( worldRay ) {

		if ( this.mesh.visible === false ) return null;

		this.mesh.updateWorldMatrix( true, false );
		this._inverse.copy( this.mesh.matrixWorld ).invert();
		this._ray.copy( worldRay ).applyMatrix4( this._inverse );

		if ( this._ray.intersectPlane( this._plane, this._hit ) === null ) return null;

		const uv = new THREE.Vector2( this._hit.x / PANEL_WIDTH + 0.5, this._hit.y / PANEL_HEIGHT + 0.5 );
		const point = this._hit.clone().applyMatrix4( this.mesh.matrixWorld );
		const inside = uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1;

		return { uv, point, distance: point.distanceTo( worldRay.origin ), inside };

	}

	// -------------------------------------------------------------------------
	// Pointer API
	// -------------------------------------------------------------------------

	pointerMove( id, hit ) {

		const drag = this.drags.get( id );

		if ( drag && hit ) {

			this._setSliderFromUV( drag, hit.uv );
			return;

		}

		const widget = hit && hit.inside ? this._widgetAt( hit.uv ) : null;

		if ( this.hover.get( id ) !== widget ) {

			this.hover.set( id, widget );
			this.dirty = true;

		}

	}

	/** Returns true when the panel consumed the press. */
	pointerDown( id, hit ) {

		if ( ! hit || ! hit.inside ) return false;

		const w = this._widgetAt( hit.uv );
		if ( ! w ) return true;

		switch ( w.type ) {

			case 'tab':
				this.activeGroup = w.index;
				break;
			case 'bool':
				this.onChange( w.key, ! params[ w.key ] );
				break;
			case 'option':
				this.onChange( w.key, w.value );
				break;
			case 'preset':
				this.onPreset( w.index );
				break;
			case 'slider':
				this.drags.set( id, w );
				this._setSliderFromUV( w, hit.uv );
				break;

		}

		this.dirty = true;
		return true;

	}

	pointerUp( id ) {

		if ( this.drags.delete( id ) ) this.dirty = true;

	}

	isDragging( id ) {

		return this.drags.has( id );

	}

	_setSliderFromUV( w, uv ) {

		const px = uv.x * W;
		let t = ( px - w.track.x ) / w.track.w;
		t = Math.min( 1, Math.max( 0, t ) );
		let v = w.item.min + t * ( w.item.max - w.item.min );
		v = Math.round( v / w.item.step ) * w.item.step;
		v = Number( v.toFixed( 5 ) );

		if ( v !== params[ w.key ] ) this.onChange( w.key, v );

	}

	_widgetAt( uv ) {

		const x = uv.x * W;
		const y = ( 1 - uv.y ) * H;

		for ( let i = this.widgets.length - 1; i >= 0; i -- ) {

			const w = this.widgets[ i ];
			const r = w.rect;
			if ( x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h ) return w;

		}

		return null;

	}

	// -------------------------------------------------------------------------
	// Drawing
	// -------------------------------------------------------------------------

	update() {

		if ( this.dirty ) this.redraw();

	}

	redraw() {

		this.dirty = false;

		const ctx = this.ctx;
		const widgets = this.widgets = [];
		const hovered = new Set( this.hover.values() );
		const dragged = new Set( this.drags.values() );

		ctx.clearRect( 0, 0, W, H );

		// background
		roundRect( ctx, 4, 4, W - 8, H - 8, 28 );
		ctx.fillStyle = COL.bg;
		ctx.fill();
		const grad = ctx.createLinearGradient( 0, 0, W, H );
		grad.addColorStop( 0, COL.accent );
		grad.addColorStop( 1, COL.accent2 );
		ctx.strokeStyle = grad;
		ctx.lineWidth = 4;
		ctx.stroke();

		// header
		ctx.font = 'bold 34px system-ui, sans-serif';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = COL.text;
		ctx.fillText( 'RENDER PIPELINE LAB', 32, 44 );
		ctx.font = '20px system-ui, sans-serif';
		ctx.fillStyle = COL.dim;
		ctx.fillText( `${ this.fps.toFixed( 0 ) } fps  ${ this.status }`, 400, 46 );

		// bypass toggle
		{

			const rect = { x: W - 250, y: 20, w: 222, h: 50 };
			const on = params.bypass;
			widgets.push( { type: 'bool', key: 'bypass', rect } );
			roundRect( ctx, rect.x, rect.y, rect.w, rect.h, 14 );
			ctx.fillStyle = on ? COL.accent : hovered.has( widgets.at( - 1 ) ) ? COL.hover : COL.off;
			ctx.fill();
			ctx.fillStyle = COL.text;
			ctx.font = 'bold 22px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText( on ? 'POST: OFF (RAW)' : 'POST: ON', rect.x + rect.w / 2, rect.y + rect.h / 2 + 1 );
			ctx.textAlign = 'left';

		}

		// tabs
		const tabX = 22, tabY = 92, tabW = 250, tabH = 47;

		GROUPS.forEach( ( g, i ) => {

			const rect = { x: tabX, y: tabY + i * tabH, w: tabW, h: tabH - 5 };
			const w = { type: 'tab', index: i, rect };
			widgets.push( w );

			const active = i === this.activeGroup;
			roundRect( ctx, rect.x, rect.y, rect.w, rect.h, 10 );
			ctx.fillStyle = active ? 'rgba(255,79,216,0.28)' : hovered.has( w ) ? COL.hover : 'rgba(255,255,255,0.03)';
			ctx.fill();

			if ( g.toggle ) {

				ctx.beginPath();
				ctx.arc( rect.x + 20, rect.y + rect.h / 2, 7, 0, Math.PI * 2 );
				ctx.fillStyle = params[ g.toggle ] ? COL.on : COL.off;
				ctx.fill();

			}

			ctx.fillStyle = active ? COL.text : COL.dim;
			ctx.font = ( active ? 'bold ' : '' ) + '22px system-ui, sans-serif';
			ctx.fillText( g.label, rect.x + 38, rect.y + rect.h / 2 + 1 );

		} );

		// group content
		const group = GROUPS[ this.activeGroup ];
		const cx = 300, cw = W - cx - 28;
		let y = 92;

		ctx.font = 'bold 28px system-ui, sans-serif';
		ctx.fillStyle = COL.text;
		ctx.fillText( group.label, cx, y + 22 );

		if ( group.toggle ) {

			const rect = { x: cx + cw - 130, y: y, w: 130, h: 46 };
			const w = { type: 'bool', key: group.toggle, rect };
			widgets.push( w );
			drawSwitch( ctx, rect, params[ group.toggle ], hovered.has( w ) );

		}

		y += 66;

		for ( const item of group.items ) {

			if ( item.type === 'bool' ) {

				const rect = { x: cx, y, w: cw, h: 52 };
				const w = { type: 'bool', key: item.key, rect };
				widgets.push( w );
				if ( hovered.has( w ) ) {

					roundRect( ctx, rect.x - 8, rect.y, rect.w + 8, rect.h, 10 );
					ctx.fillStyle = COL.hover;
					ctx.fill();

				}

				ctx.font = '23px system-ui, sans-serif';
				ctx.fillStyle = COL.text;
				ctx.fillText( item.label, cx, y + 26 );
				drawSwitch( ctx, { x: cx + cw - 110, y: y + 4, w: 110, h: 44 }, params[ item.key ], false );
				y += 66;

			} else if ( item.type === 'select' ) {

				ctx.font = '23px system-ui, sans-serif';
				ctx.fillStyle = COL.text;
				ctx.fillText( item.label, cx, y + 16 );
				y += 34;

				const n = item.options.length;
				const gap = 8;
				const bw = ( cw - gap * ( n - 1 ) ) / n;

				item.options.forEach( ( [ label, value ], j ) => {

					const rect = { x: cx + j * ( bw + gap ), y, w: bw, h: 48 };
					const w = { type: 'option', key: item.key, value, rect };
					widgets.push( w );
					const on = params[ item.key ] === value;
					roundRect( ctx, rect.x, rect.y, rect.w, rect.h, 10 );
					ctx.fillStyle = on ? COL.accent : hovered.has( w ) ? COL.hover : COL.track;
					ctx.fill();
					ctx.fillStyle = COL.text;
					ctx.font = '20px system-ui, sans-serif';
					ctx.textAlign = 'center';
					ctx.fillText( label, rect.x + bw / 2, rect.y + 25 );
					ctx.textAlign = 'left';

				} );

				y += 66;

			} else {

				const value = params[ item.key ];
				const t = ( value - item.min ) / ( item.max - item.min );
				const rect = { x: cx - 8, y, w: cw + 16, h: 70 };
				const track = { x: cx + 12, w: cw - 24 };
				const w = { type: 'slider', key: item.key, item, rect, track };
				widgets.push( w );

				const active = dragged.has( w ) || [ ...dragged ].some( ( d ) => d.key === item.key );

				if ( hovered.has( w ) || active ) {

					roundRect( ctx, rect.x, rect.y, rect.w, rect.h, 10 );
					ctx.fillStyle = COL.hover;
					ctx.fill();

				}

				ctx.font = '22px system-ui, sans-serif';
				ctx.fillStyle = COL.text;
				ctx.fillText( item.label, cx, y + 18 );
				ctx.textAlign = 'right';
				ctx.fillStyle = COL.accent;
				ctx.fillText( formatValue( value, item.step ), cx + cw, y + 18 );
				ctx.textAlign = 'left';

				const ty = y + 48;
				roundRect( ctx, track.x, ty - 5, track.w, 10, 5 );
				ctx.fillStyle = COL.track;
				ctx.fill();

				const g2 = ctx.createLinearGradient( track.x, 0, track.x + track.w, 0 );
				g2.addColorStop( 0, COL.accent2 );
				g2.addColorStop( 1, COL.accent );
				roundRect( ctx, track.x, ty - 5, Math.max( 10, track.w * t ), 10, 5 );
				ctx.fillStyle = g2;
				ctx.fill();

				ctx.beginPath();
				ctx.arc( track.x + track.w * t, ty, active ? 15 : 12, 0, Math.PI * 2 );
				ctx.fillStyle = '#ffffff';
				ctx.fill();

				y += 76;

			}

		}

		// presets
		const py = H - 84;
		ctx.font = '18px system-ui, sans-serif';
		ctx.fillStyle = COL.dim;
		ctx.fillText( 'PRESETS', 32, py - 14 );

		const n = PRESETS.length;
		const gap = 10;
		const bw = ( W - 56 - gap * ( n - 1 ) ) / n;

		PRESETS.forEach( ( preset, i ) => {

			const rect = { x: 28 + i * ( bw + gap ), y: py, w: bw, h: 56 };
			const w = { type: 'preset', index: i, rect };
			widgets.push( w );
			roundRect( ctx, rect.x, rect.y, rect.w, rect.h, 12 );
			ctx.fillStyle = hovered.has( w ) ? 'rgba(127,155,255,0.35)' : COL.track;
			ctx.fill();
			ctx.fillStyle = COL.text;
			ctx.font = 'bold 21px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText( preset.name, rect.x + bw / 2, rect.y + 29 );
			ctx.textAlign = 'left';

		} );

		this.texture.needsUpdate = true;

	}

}

function formatValue( v, step ) {

	const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
	return v.toFixed( decimals );

}

function drawSwitch( ctx, rect, on, hover ) {

	roundRect( ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2 );
	ctx.fillStyle = on ? COL.on : hover ? '#4b3280' : COL.off;
	ctx.fill();
	const r = rect.h / 2 - 5;
	ctx.beginPath();
	ctx.arc( on ? rect.x + rect.w - r - 5 : rect.x + r + 5, rect.y + rect.h / 2, r, 0, Math.PI * 2 );
	ctx.fillStyle = '#ffffff';
	ctx.fill();
	ctx.fillStyle = on ? '#ffffff' : COL.dim;
	ctx.font = 'bold 17px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText( on ? 'ON' : 'OFF', on ? rect.x + ( rect.w - r * 2 ) / 2 : rect.x + rect.w - ( rect.w - r * 2 ) / 2 - 4, rect.y + rect.h / 2 + 1 );
	ctx.textAlign = 'left';

}

function roundRect( ctx, x, y, w, h, r ) {

	ctx.beginPath();
	ctx.roundRect( x, y, w, h, r );

}
