// Villar engine — box-projected (parallax-corrected) environment reflections. Owner: engine.
//
// The room is captured into one cube map at a fixed point. Without parallax correction every
// reflection is looked up as if the room were infinitely far away, so the window shows up in the
// wrong place on the floor and the glazing reflects nothing sensible at night. This global chunk
// patch intersects the reflection ray with the apartment's AABB (baked in as #defines — no
// per-material uniforms, no ShaderMaterial) and looks the env map up toward that hit point.
// Only fragments inside the box are corrected; exterior objects (skyline, balcony) are untouched.
import * as THREE from 'three';

let patched = false;
const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const v3 = (a) => `vec3( ${f(a[0])}, ${f(a[1])}, ${f(a[2])} )`;

export function patchReflectionChunks({ min, max, probe }) {
  if (patched) return; patched = true;
  const C = THREE.ShaderChunk;
  const head = `#ifdef USE_ENVMAP
	#define VILLAR_BOX_ENV
	#define VILLAR_BOX_MIN ${v3(min)}
	#define VILLAR_BOX_MAX ${v3(max)}
	#define VILLAR_BOX_PROBE ${v3(probe)}
	vec3 villarWorldPos = vec3( 1e6 );
	vec3 villarBoxProject( vec3 rv, const in float roughness ) {
		if ( all( greaterThan( villarWorldPos, VILLAR_BOX_MIN ) ) && all( lessThan( villarWorldPos, VILLAR_BOX_MAX ) ) ) {
			vec3 tA = ( VILLAR_BOX_MAX - villarWorldPos ) / rv;
			vec3 tB = ( VILLAR_BOX_MIN - villarWorldPos ) / rv;
			vec3 tF = max( tA, tB );
			float t = min( min( tF.x, tF.y ), tF.z );
			if ( t > 0.0 && t < 1e4 ) {
				vec3 c = normalize( villarWorldPos + rv * t - VILLAR_BOX_PROBE );
				return normalize( mix( c, rv, clamp( roughness * roughness * 1.5, 0.0, 1.0 ) ) );
			}
		}
		return rv;
	}
#endif
`;
  const src = C.envmap_physical_pars_fragment;
  const anchor = 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );';
  if (!src.includes(anchor)) { console.debug('[villar] envmap chunk changed; box projection disabled'); return; }
  C.envmap_physical_pars_fragment = head + src.replace(anchor, `${anchor}\n\t\t\treflectVec = villarBoxProject( reflectVec, roughness );`);
  const maps = C.lights_fragment_maps;
  const call = 'vec3 iblRadiance = getIBLRadiance(';
  const i = maps.indexOf('#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )');
  if (i >= 0) {
    const j = maps.indexOf('\n', i);
    C.lights_fragment_maps = maps.slice(0, j + 1)
      + '\t#ifdef VILLAR_BOX_ENV\n\tvillarWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;\n\t#endif\n'
      + maps.slice(j + 1);
  }
  void call;
}
