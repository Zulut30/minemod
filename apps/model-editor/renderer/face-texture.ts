import * as THREE from "three";

/** Семплируем целый texel внутри грани: позиция в атласе не меняет nearest-preview. */
export function faceTextureShader(): THREE.Material["onBeforeCompile"] {
  return shader => {
    const varyings = "varying vec2 vStudioPixel;\nvarying vec4 vStudioRect;\n";
    shader.vertexShader = "attribute vec2 studioPixel;\nattribute vec4 studioRect;\n" + varyings + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>",
      "#include <uv_vertex>\nvStudioPixel = studioPixel;\nvStudioRect = studioRect;");
    shader.fragmentShader = varyings + shader.fragmentShader;
    const sample = "texture2D( map, vMapUv )";
    if (!THREE.ShaderChunk.map_fragment.includes(sample)) throw new Error("Изменился контракт shader map_fragment; nearest-preview требует проверки.");
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      vec2 studioTextureSize = vec2(textureSize(map, 0));
      vec2 studioTexel = clamp(floor(vStudioPixel), vec2(0.0), vStudioRect.zw - vec2(1.0));
      vec2 studioMapUv = (vStudioRect.xy + studioTexel + vec2(0.5)) / studioTextureSize;
      studioMapUv.y = 1.0 - studioMapUv.y;
      ${THREE.ShaderChunk.map_fragment.replace(sample, "texture2D( map, studioMapUv )")}
    `);
  };
}
