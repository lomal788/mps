"""VFXB (nn::vfx2 파티클 바이너리) 파서 / 덤프 / 검사. Jamboree 버전 53 + [mps] Superstars 버전 40(EmitterData 0xB80, 아래 V40 표).

usage:
  effect_vfxb.py tree  <ConvertList.xml>                     섹션 트리 출력
  effect_vfxb.py dump  <ConvertList.xml> <out_dir> [--png]     JSON 덤프(+ textures.bntx, primitives.bfres, --png 면 텍스처 png)
  effect_vfxb.py check <root>                                  <root> 아래 모든 _Vfx/**/ConvertList.xml 구조 검사·통계
  effect_vfxb.py find  <root> <emitter_set_name>               이미터셋 이름이 들어 있는 파일 찾기

형식 근거:
  - 섹션 헤더·섹션 종류(ESTA/ESET/EMTR/ESFT/GRTF/GTNT/PRMA/TRMA/G3PR/G3NT/GRSN/GRSC)와 이미터 바이너리(EmitterData)
    필드 순서는 KillzXGaming/EffectLibrary (tools/oss/EffectLibrary, EFT2/EmitterStructs/Emitter.cs) 의
    VersionCheck 를 버전 53 에 적용한 것이다. 필드 이름도 그 소스를 따른다(원본 심볼 아님).
  - 정렬 없이 순서대로 읽는다(EffectLibrary PtclSerialize 와 같다).
  - check 명령이 모든 파일에서 (a) 구조체 크기 <= 이미터 바이너리 크기, (b) 샘플러 TextureID 가 GTNT 표에 있는지,
    (c) 이름 문자열이 ESET 자식 이름과 일치하는지 등을 확인한다.
"""
import glob
import json
import os
import struct
import sys

NULL = 0xFFFFFFFF
HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- field spec (version 53)
# 원소: (이름, 타입) 또는 (이름, 타입, 개수). 타입은 기본형 문자열 또는 다른 구조체 이름.
PRIM = {
    "u8": ("<B", 1), "b": ("<?", 1), "i16": ("<h", 2), "u16": ("<H", 2), "u32": ("<I", 4), "i32": ("<i", 4),
    "f32": ("<f", 4), "u64": ("<Q", 8),
}


def F(n, t, c=None):
    return (n, t, c)


KEYTABLE = [F("keys", "Key", 8)]
KEY = [F("x", "f32"), F("y", "f32"), F("z", "f32"), F("time", "f32")]

TEXPAT = [F("num", "f32"), F("frequency", "f32"), F("numRandom", "f32"), F("pad", "f32"), F("table", "i32", 32)]
TEXSCROLL = [F(n, "f32") for n in (
    "scrollAddX", "scrollAddY", "scrollX", "scrollY", "scrollRandomX", "scrollRandomY",
    "scaleAddX", "scaleAddY", "scaleX", "scaleY", "scaleRandomX", "scaleRandomY",
    "rotationAdd", "rotation", "rotationRandom", "rotationType", "uvScaleX", "uvScaleY", "uvDivX", "uvDivY")]

EMITTER_STATIC = (
    [F("flags1", "u32"), F("flags2", "u32"), F("flags3", "u32"), F("flags4", "u32"),
     F("numColor0Keys", "u32"), F("numAlpha0Keys", "u32"), F("numColor1Keys", "u32"), F("numAlpha1Keys", "u32"),
     F("numScaleKeys", "u32"), F("numParamKeys", "u32"), F("unknown1", "u32"), F("unknown2", "u32"),
     F("numAnim2Keys", "u32"), F("numAnim3Keys", "u32"), F("numAnim4Keys", "u32"), F("numAnim5Keys", "u32"),
     F("unknownV53", "u32", 8)]
    + [F(n, "f32") for n in (
        "color0LoopRate", "alpha0LoopRate", "color1LoopRate", "alpha1LoopRate", "scaleLoopRate",
        "color0LoopRandom", "alpha0LoopRandom", "color1LoopRandom", "alpha1LoopRandom", "scaleLoopRandom",
        "unknown3", "unknown4", "gravityDirX", "gravityDirY", "gravityDirZ", "gravityScale", "airRes",
        "val_0x74", "val_0x78", "val_0x7C", "centerX", "centerY", "offset", "padding",
        "amplitudeX", "amplitudeY", "cycleX", "cycleY", "phaseRndX", "phaseRndY", "phaseInitX", "phaseInitY",
        "coefficient0", "coefficient1", "val_0xB8", "val_0xBC")]
    + [F("texPatternAnim", "TexPat", 6), F("texScrollAnim", "TexScroll", 6)]
    + [F(n, "f32") for n in ("colorScale", "val_0x364", "val_0x368", "val_0x36C")]
    + [F("color0", "KeyTable"), F("alpha0", "KeyTable"), F("color1", "KeyTable"), F("alpha1", "KeyTable")]
    + [F(n, "f32") for n in (
        "softEdgeParam1", "softEdgeParam2", "fresnelAlphaParam1", "fresnelAlphaParam2",
        "nearDistAlphaParam1", "nearDistAlphaParam2", "farDistAlphaParam1", "farDistAlphaParam2",
        "decalParam1", "decalParam2", "alphaThreshold", "padding2",
        "addVelToScale", "softParticleDist", "softParticleVolume", "padding3")]
    + [F("scaleAnim", "KeyTable"), F("paramAnim", "KeyTable"),
       F("anim1Keys", "KeyTable"), F("anim2Keys", "KeyTable"), F("anim3Keys", "KeyTable"), F("anim4Keys", "KeyTable"),
       F("unknown6", "f32", 16)]
    + [F(n, "f32") for n in (
        "rotateInitX", "rotateInitY", "rotateInitZ", "rotateInitEmpty",
        "rotateInitRandX", "rotateInitRandY", "rotateInitRandZ", "rotateInitRandEmpty",
        "rotateAddX", "rotateAddY", "rotateAddZ", "rotateRegist",
        "rotateAddRandX", "rotateAddRandY", "rotateAddRandZ", "padding4",
        "scaleLimitDistNear", "scaleLimitDistFar", "padding5", "padding6")]
    + [F("unknown7", "f32", 16)]
)

EMITTER_INFO = (
    [F(n, "u8") for n in (
        "isParticleDraw", "sortType", "calcType", "followType", "isFadeEmit", "isFadeAlphaFade", "isScaleFade",
        "randomSeedType", "isUpdateMatrixByEmit", "testAlways", "interpolateEmissionAmount", "isAlphaFadeIn",
        "isScaleFadeIn", "pad1", "pad2", "pad3")]
    + [F("randomSeed", "u32"), F("drawPath", "u32"), F("alphaFadeTime", "i32"), F("fadeInTime", "i32")]
    + [F(n, "f32") for n in (
        "transX", "transY", "transZ", "transRandX", "transRandY", "transRandZ",
        "rotateX", "rotateY", "rotateZ", "rotateRandX", "rotateRandY", "rotateRandZ",
        "scaleX", "scaleY", "scaleZ", "color0R", "color0G", "color0B", "color0A",
        "color1R", "color1G", "color1B", "color1A", "emissionRangeNear", "emissionRangeFar", "emissionRatioFar")]
)

INHERIT = (
    [F(n, "u8") for n in (
        "velocity", "scale", "rotate", "colorScale", "color0", "color1", "alpha0", "alpha1", "drawPath", "preDraw",
        "alpha0EachFrame", "alpha1EachFrame", "enableEmitterParticle", "pad1", "pad2", "pad3")]
    + [F("unknownV40", "u64"), F("velocityRate", "f32"), F("scaleRate", "f32")]
)

EMISSION = (
    [F("isOneTime", "b"), F("isWorldGravity", "b"), F("isEmitDistEnabled", "b"), F("isWorldOrientedVelocity", "b"),
     # +0xD6C start(프레임), +0xD70 timing(자식: 부모 수명 %), +0xD74 duration(프레임), +0xD78 rate,
     # +0xD7C rateRandom(정수 %, 코드가 바이트로 읽음), +0xD80 interval(방출 간격-1 프레임), +0xD84 intervalRandom(정수)
     F("start", "u32"), F("timing", "u32"), F("duration", "u32"), F("rate", "f32"), F("rateRandom", "u32"),
     F("interval", "i32"), F("intervalRandom", "u32"), F("positionRandom", "f32"), F("gravityScale", "f32"),
     F("gravityDirX", "f32"), F("gravityDirY", "f32"), F("gravityDirZ", "f32"),
     F("emitterDistUnit", "f32"), F("emitterDistMin", "f32"), F("emitterDistMax", "f32"), F("emitterDistMarg", "f32"),
     F("emitterDistParticlesMax", "i32")]
)

SHAPE = (
    [F(n, "u8") for n in (
        "volumeType", "sweepStartRandom", "arcType", "isVolumeLatitudeEnabled", "volumeTblIndex", "volumeTblIndex64",
        "volumeLatitudeDir", "isGpuEmitter")]
    + [F(n, "f32") for n in (
        "sweepLongitude", "sweepLatitude", "sweepStart", "volumeSurfacePosRand", "caliberRatio", "lineCenter",
        "lineLength", "volumeRadiusX", "volumeRadiusY", "volumeRadiusZ", "volumeFormScaleX", "volumeFormScaleY",
        "volumeFormScaleZ")]
    + [F("primEmitType", "i32"), F("primitiveIndex", "u64"), F("numDivideCircle", "i32"),
       F("numDivideCircleRandom", "i32"), F("numDivideLine", "i32"), F("numDivideLineRandom", "i32")]
)

RENDER = (
    [F("isBlendEnable", "b"), F("isDepthTest", "b"), F("depthFunc", "u8"), F("isDepthMask", "b"),
     F("isAlphaTest", "b"), F("alphaFunc", "u8"), F("blendType", "u8"), F("displaySide", "u8"),
     F("alphaThreshold", "f32"), F("padding", "u32")]
)

PARTICLE = (
    [F("infiniteLife", "b"), F("isTriming", "b"), F("billboardType", "u8"), F("rotType", "u8"), F("offsetType", "u8"),
     F("rotRevRandX", "b"), F("rotRevRandY", "b"), F("rotRevRandZ", "b"), F("isRotateX", "b"), F("isRotateY", "b"),
     F("isRotateZ", "u8"), F("primitiveScaleType", "u8"), F("isTextureCommonRandom", "u8"),
     F("connectPtclScaleAndZOffset", "u8"), F("enableAvoidZFighting", "u8"), F("val_0xF", "u8"),
     F("life", "i32"), F("lifeRandom", "i32"), F("momentumRandom", "f32"), F("primitiveVertexInfoFlags", "u32"),
     F("primitiveID", "u64"), F("primitiveExID", "u64")]
    + [F(n, "b") for n in (
        "loopColor0", "loopAlpha0", "loopColor1", "loopAlpha1", "scaleLoop", "loopRandomColor0", "loopRandomAlpha0",
        "loopRandomColor1", "loopRandomAlpha1", "scaleLoopRandom")]
    + [F("primFlag1", "u8"), F("primFlag2", "u8")]
    # v53: EffectLibrary v50 배치와 다르다. 아래는 표본 6,057개 값 분포로 맞춘 배치(+0xE54~+0xE77).
    + [F("unknownE54", "u32"), F("unknownE58", "u32")]
    + [F(n, "i16") for n in ("color0LoopRate16", "alpha0LoopRate16", "color1LoopRate16", "alpha1LoopRate16",
                             "scaleLoopRate16")]
    + [F("padE66", "i16"), F("unknownE68", "i32", 4)]
)

COMBINER = (
    [F(n, "u8") for n in (
        "colorCombinerProcess", "alphaCombinerProcess", "texture1ColorBlend", "texture2ColorBlend",
        "primitiveColorBlend", "texture1AlphaBlend", "texture2AlphaBlend", "primitiveAlphaBlend",
        "texColor0InputType", "texColor1InputType", "texColor2InputType", "texAlpha0InputType",
        "texAlpha1InputType", "texAlpha2InputType", "primitiveColorInputType", "primitiveAlphaInputType")]
    # v53: 16바이트뿐(EffectLibrary v50 의 추가 10바이트 없음)
)

SHADERREF = (
    # v53 배치(+0xE88~+0xF33). shaderIndex(+0xE94)는 파일 안 이미터 순서대로 0,1,2… 로 증가하는 BNSH 변형 번호,
    # shaderIndex2(+0xE98)는 -1 이거나 다음 번호. computeShaderIndex(+0xEA0) 이름은 추정(-1 이 대부분).
    [F("type", "u8"), F("val_0x1", "u8"), F("hasShaderIndex2", "u8"), F("val_0x3", "u8"),
     F("unknownE8C", "i32"), F("unknownE90", "i32"), F("shaderIndex", "i32"), F("shaderIndex2", "i32"),
     F("unknownE9C", "i32"), F("computeShaderIndex", "i32"), F("unknownEA4", "i32"), F("unknownEA8", "i32"),
     F("unknownEAC", "i32"), F("unknownEB0", "i32"), F("reservedEB4", "bytes60"), F("userShaderDefine", "str16"),
     F("reservedF00", "bytes48"), F("actionIndex", "u32")]
)

ACTION = [F("actionIndex", "u32"), F("unknown", "u32", 5)]

VELOCITY = [F(n, "f32") for n in (
    "allDirection", "designatedDirScale", "designatedDirX", "designatedDirY", "designatedDirZ", "diffusionDirAngle",
    "xzDiffusion", "diffusionX", "diffusionY", "diffusionZ", "velRandom", "emVelInherit")]

PCOLOR = (
    [F(n, "u8") for n in (
        "isSoftParticle", "isFresnelAlpha", "isNearDistAlpha", "isFarDistAlpha", "isDecal", "val_0x5", "val_0x6",
        "val_0x7", "color0Type", "color1Type", "alpha0Type", "alpha1Type")]
    + [F(n, "f32") for n in ("color0R", "color0G", "color0B", "alpha0", "color1R", "color1G", "color1B", "alpha1")]
)

PSCALE = (
    [F(n, "f32") for n in ("scaleX", "scaleY", "scaleZ", "scaleRandomX", "scaleRandomY", "scaleRandomZ")]
    + [F(n, "u8") for n in ("enableScalingByCameraDistNear", "enableScalingByCameraDistFar", "enableAddScaleY",
                            "enableLinkFovyToScaleValue")]
    + [F("scaleMin", "f32"), F("scaleMax", "f32")]
)

FLUC = [F(n, "u8") for n in ("isApplyAlpha", "isApplyScale", "isApplyScaleY", "isWaveType", "isPhaseRandomX",
                             "isPhaseRandomY", "pad1", "pad2")] + [F("pad3", "u32")]

SAMPLER = [F("textureID", "u64"), F("wrapU", "u8"), F("wrapV", "u8"), F("filter", "u8"), F("isSphereMap", "u8"),
           F("maxLOD", "f32"), F("lodBias", "f32"), F("mipLevelLimit", "u8"), F("isDensityFixedU", "u8"),
           F("isDensityFixedV", "u8"), F("isSquareRgb", "u8")]

TEXANIM = [F(n, "u8") for n in ("patternAnimType", "isScroll", "isRotate", "isScale", "repeat", "invRandU", "invRandV",
                                "isPatAnimLoopRandom", "uvChannel", "isCrossfade", "pad1", "pad2")] + [F("pad3", "u32")]

EMITTER_DATA = [
    F("flag", "u32"), F("randomSeed", "u32"), F("padding1", "u32"), F("padding2", "u32"), F("name", "str96"),
    F("static", "EmitterStatic"), F("info", "EmitterInfo"), F("inherit", "Inherit"), F("emission", "Emission"),
    F("shape", "Shape"), F("render", "Render"), F("particle", "Particle"), F("combiner", "Combiner"),
    F("shaderRef", "ShaderRef"), F("velocity", "Velocity"), F("unknownV36", "f32", 4), F("color", "PColor"), F("scale", "PScale"),
    F("fluctuation", "Fluc"), F("samplers", "Sampler", 6), F("texAnims", "TexAnim", 6), F("reserved", "bytes64"),
]

STRUCTS = {
    "Key": KEY, "KeyTable": KEYTABLE, "TexPat": TEXPAT, "TexScroll": TEXSCROLL, "EmitterStatic": EMITTER_STATIC,
    "EmitterInfo": EMITTER_INFO, "Inherit": INHERIT, "Emission": EMISSION, "Shape": SHAPE, "Render": RENDER,
    "Particle": PARTICLE, "Combiner": COMBINER, "ShaderRef": SHADERREF, "Action": ACTION, "Velocity": VELOCITY,
    "PColor": PCOLOR, "PScale": PSCALE, "Fluc": FLUC, "Sampler": SAMPLER, "TexAnim": TEXANIM,
    "EmitterData": EMITTER_DATA,
}

# ---------------------------------------------------------------- field spec (version 40, Mario Party Superstars)
# [mps] EmitterData 0xB80 B. 근거(web/docs/engine/08_effects.md 4.3):
#   [판독] main nn::vfx2 코드가 그 오프셋을 그 폭·뜻으로 읽음(web/tools/analysis/vfx40_scan.py, analysis/decomp/vfx40_*.c)
#   [데이터] 125 파일 3,674 이미터 열 비교(키 개수↔키표, 텍스처 ID↔GTNT, CSDP/CADP 하위 섹션↔플래그 일치)
# 배치 = EffectLibrary 의 v39 이하 배치 + 아래 차이: Static 끝의 unknown6·unknown7(각 f32×16, 라이브러리는 v41+ 로 둠)이 v40 에도 있다,
#   Inherit 의 +0x868 칸(4 B)+0x86C 플래그, ShaderRef 가 0x80 B(정의 문자열 +0x9F0), Action 4 B(+0xA10),
#   샘플러·TexAnim·TexPat·TexScroll 은 3개(라이브러리 v40 이하와 같음).
EMITTER_STATIC_V40 = (
    [F("flags1", "u32"), F("flags2", "u32"), F("flags3", "u32"), F("flags4", "u32"),
     F("numColor0Keys", "u32"), F("numAlpha0Keys", "u32"), F("numColor1Keys", "u32"), F("numAlpha1Keys", "u32"),
     F("numScaleKeys", "u32"), F("numParamKeys", "u32"), F("unknown1", "u32"), F("unknown2", "u32")]
    + [F(n, "f32") for n in (
        "color0LoopRate", "alpha0LoopRate", "color1LoopRate", "alpha1LoopRate", "scaleLoopRate",
        "color0LoopRandom", "alpha0LoopRandom", "color1LoopRandom", "alpha1LoopRandom", "scaleLoopRandom",
        "unknown3", "unknown4", "gravityDirX", "gravityDirY", "gravityDirZ", "gravityScale", "airRes",
        "val_0x74", "val_0x78", "val_0x7C", "centerX", "centerY", "offset", "padding",
        "amplitudeX", "amplitudeY", "cycleX", "cycleY", "phaseRndX", "phaseRndY", "phaseInitX", "phaseInitY",
        "coefficient0", "coefficient1", "val_0xB8", "val_0xBC")]
    + [F("texPatternAnim", "TexPat", 3), F("texScrollAnim", "TexScroll", 3)]
    + [F(n, "f32") for n in ("colorScale", "val_0x364", "val_0x368", "val_0x36C")]
    + [F("color0", "KeyTable"), F("alpha0", "KeyTable"), F("color1", "KeyTable"), F("alpha1", "KeyTable")]
    + [F(n, "f32") for n in (
        "softEdgeParam1", "softEdgeParam2", "fresnelAlphaParam1", "fresnelAlphaParam2",
        "nearDistAlphaParam1", "nearDistAlphaParam2", "farDistAlphaParam1", "farDistAlphaParam2",
        "decalParam1", "decalParam2", "alphaThreshold", "padding2",
        "addVelToScale", "softParticleDist", "softParticleVolume", "padding3")]
    + [F("scaleAnim", "KeyTable"), F("paramAnim", "KeyTable"), F("unknown6", "f32", 16)]
    + [F(n, "f32") for n in (
        "rotateInitX", "rotateInitY", "rotateInitZ", "rotateInitEmpty",
        "rotateInitRandX", "rotateInitRandY", "rotateInitRandZ", "rotateInitRandEmpty",
        "rotateAddX", "rotateAddY", "rotateAddZ", "rotateRegist",
        "rotateAddRandX", "rotateAddRandY", "rotateAddRandZ", "padding4",
        "scaleLimitDistNear", "scaleLimitDistFar", "padding5", "padding6")]
    + [F("unknown7", "f32", 16)]
)

EMITTER_INFO_V40 = (
    # +0x7D0. 바이트 뜻은 코드 판독(FUN_71009f60d4): +0x7D8 정지 중 방출 억제, +0x7D9/+0x7DA 페이드 인(fadeInTime +0x7EC),
    # +0x7DB/+0x7DC 페이드 아웃(alphaFadeTime +0x7E8). 알파/스케일 구분은 이름 순서로 본 추정.
    [F(n, "u8") for n in (
        "isParticleDraw", "sortType", "calcType", "followType", "unknown7D4", "unknown7D5", "unknown7D6",
        "randomSeedType", "isFadeEmit", "isAlphaFadeIn", "isScaleFadeIn", "isAlphaFadeOut",
        "isScaleFadeOut", "pad1", "pad2", "pad3")]
    + [F("randomSeed", "u32"), F("drawPath", "u32"), F("alphaFadeTime", "i32"), F("fadeInTime", "i32")]
    + [F(n, "f32") for n in (
        "transX", "transY", "transZ", "transRandX", "transRandY", "transRandZ",
        "rotateX", "rotateY", "rotateZ", "rotateRandX", "rotateRandY", "rotateRandZ",
        "scaleX", "scaleY", "scaleZ", "color0R", "color0G", "color0B", "color0A",
        "color1R", "color1G", "color1B", "color1A", "emissionRangeNear", "emissionRangeFar", "emissionRatioFar")]
)

INHERIT_V40 = (
    [F(n, "u8") for n in (
        "velocity", "scale", "rotate", "colorScale", "color0", "color1", "alpha0", "alpha1", "drawPath", "preDraw",
        "alpha0EachFrame", "alpha1EachFrame", "enableEmitterParticle", "pad1", "pad2", "pad3")]
    # +0x86C: 자식 이미터일 때 방출 시작을 부모 입자 수명 %(timing)로 잡는지 / 최대 입자 수에 부모 수를 곱하는지 가르는 플래그 [판독]
    + [F("unknown868", "u32"), F("childEmitByParentTime", "u8"), F("pad4", "u8"), F("pad5", "u8"), F("pad6", "u8"),
       F("velocityRate", "f32"), F("scaleRate", "f32")]
)

EMISSION_V40 = (
    [F("isOneTime", "b"), F("isWorldGravity", "b"), F("isEmitDistEnabled", "b"), F("isWorldOrientedVelocity", "b"),
     F("start", "u32"), F("timing", "u32"), F("duration", "u32"), F("rate", "f32"), F("rateRandom", "i32"),
     F("interval", "i32"), F("intervalRandom", "i32"), F("positionRandom", "f32"), F("gravityScale", "f32"),
     F("gravityDirX", "f32"), F("gravityDirY", "f32"), F("gravityDirZ", "f32"),
     F("emitterDistUnit", "f32"), F("emitterDistMin", "f32"), F("emitterDistMax", "f32"), F("emitterDistMarg", "f32"),
     F("emitterDistParticlesMax", "i32")]
)

SHAPE_V40 = SHAPE + [F("isOnAnotherBinaryVolumePrimitive", "u8"), F("shapePad1", "u8"), F("shapePad2", "u8"),
                     F("shapePad3", "u8"), F("shapePad4", "u32")]

PARTICLE_V40 = (
    [F("infiniteLife", "b"), F("isTriming", "b"), F("billboardType", "u8"), F("rotType", "u8"), F("offsetType", "u8"),
     F("rotRevRandX", "b"), F("rotRevRandY", "b"), F("rotRevRandZ", "b"), F("isRotateX", "b"), F("isRotateY", "b"),
     F("isRotateZ", "u8"), F("primitiveScaleType", "u8"), F("isTextureCommonRandom", "u8"),
     F("connectPtclScaleAndZOffset", "u8"), F("enableAvoidZFighting", "u8"), F("val_0xF", "u8"),
     F("life", "i32"), F("lifeRandom", "i32"), F("momentumRandom", "f32"), F("primitiveVertexInfoFlags", "u32"),
     F("primitiveID", "u64"), F("primitiveExID", "u64")]
    + [F(n, "b") for n in (
        "loopColor0", "loopAlpha0", "loopColor1", "loopAlpha1", "scaleLoop", "loopRandomColor0", "loopRandomAlpha0",
        "loopRandomColor1", "loopRandomAlpha1", "scaleLoopRandom")]
    + [F("primFlag1", "u8"), F("primFlag2", "u8")]
    + [F(n, "i32") for n in ("color0LoopRate", "alpha0LoopRate", "color1LoopRate", "alpha1LoopRate", "scaleLoopRate")]
)

COMBINER_V40 = (
    # +0x980..+0x984: 키표 보간 방식(0 선형, 1 계단) — FUN_71009febb0 이 color0=+0x980, alpha0=+0x981 을 FUN_71009fc110 에 넘김 [판독].
    # 나머지 이름은 EffectLibrary Combiner 순서를 따른 [추정](+0x98B~+0x98D 가 거의 늘 8).
    [F(n, "u8") for n in (
        "color0Interp", "alpha0Interp", "color1Interp", "alpha1Interp", "scaleInterp", "combiner5", "combiner6",
        "combiner7", "texColor0InputType", "texColor1InputType", "texColor2InputType", "texAlpha0InputType",
        "texAlpha1InputType", "texAlpha2InputType", "primitiveColorInputType", "primitiveAlphaInputType")]
)

SHADERREF_V40 = (
    # +0x990..+0xA0F. +0x994 shaderIndex·+0x998 computeShaderIndex 는 코드가 읽음(FUN_71009f3508) [판독].
    # +0x998 은 calcType 2(GPU+스트림아웃) 이미터에서만 −1 이 아니다, +0x9A4 = 1 ⇔ CSDP 하위 섹션(1,156/1,156) [데이터].
    [F("type", "u8"), F("val_0x1", "u8"), F("val_0x2", "u8"), F("val_0x3", "u8"),
     F("shaderIndex", "i32"), F("computeShaderIndex", "i32"), F("userShaderIndex1", "i32"), F("userShaderIndex2", "i32"),
     F("customShaderIndex", "i32"), F("customShaderFlag", "u64"), F("customShaderSwitch", "u64"),
     F("reserved9B8", "bytes48"), F("unknown9E8", "i32"), F("unknown9EC", "u32"),
     F("userShaderDefine", "str16"), F("userShaderDefine2", "str16")]
)

ACTION_V40 = [F("actionIndex", "u32")]  # +0xA10, ≠0 ⇔ CADP 하위 섹션(126/126) [데이터]

SAMPLER_V40 = SAMPLER + [F("isOnAnotherBinary", "u8"), F("samplerPad1", "u8"), F("samplerPad2", "u8"),
                         F("samplerPad3", "u8"), F("samplerPad4", "u32")]

EMITTER_DATA_V40 = [
    F("flag", "u32"), F("randomSeed", "u32"), F("padding1", "u32"), F("padding2", "u32"), F("name", "str64"),
    F("static", "EmitterStaticV40"), F("info", "EmitterInfoV40"), F("inherit", "InheritV40"),
    F("emission", "EmissionV40"), F("shape", "ShapeV40"), F("render", "Render"), F("particle", "ParticleV40"),
    F("combiner", "CombinerV40"), F("shaderRef", "ShaderRefV40"), F("action", "ActionV40"), F("velocity", "Velocity"),
    F("unknownV36", "f32", 4), F("color", "PColor"), F("scale", "PScale"), F("fluctuation", "Fluc"),
    F("samplers", "SamplerV40", 3), F("texAnims", "TexAnim", 3), F("reserved", "bytes64"),
]

STRUCTS.update({
    "EmitterStaticV40": EMITTER_STATIC_V40, "EmitterInfoV40": EMITTER_INFO_V40, "InheritV40": INHERIT_V40,
    "EmissionV40": EMISSION_V40, "ShapeV40": SHAPE_V40, "ParticleV40": PARTICLE_V40, "CombinerV40": COMBINER_V40,
    "ShaderRefV40": SHADERREF_V40, "ActionV40": ACTION_V40, "SamplerV40": SAMPLER_V40,
    "EmitterDataV40": EMITTER_DATA_V40,
})


def emitter_struct(version):
    return "EmitterDataV40" if version == 40 else "EmitterData"


def struct_size(name):
    total = 0
    for n, t, c in STRUCTS[name]:
        total += type_size(t) * (c or 1)
    return total


def type_size(t):
    if t in PRIM:
        return PRIM[t][1]
    if t.startswith("str"):
        return int(t[3:])
    if t.startswith("bytes"):
        return int(t[5:])
    return struct_size(t)


def read_struct(d, off, name, offsets=None, prefix=""):
    out = {}
    for n, t, c in STRUCTS[name]:
        vals = []
        for i in range(c or 1):
            if offsets is not None:
                offsets[f"{prefix}{n}" + (f"[{i}]" if c else "")] = off
            if t in PRIM:
                v = struct.unpack_from(PRIM[t][0], d, off)[0]
                if t == "f32":
                    v = float(struct.unpack("<f", struct.pack("<f", v))[0])
                off += PRIM[t][1]
            elif t.startswith("str"):
                sz = int(t[3:])
                v = d[off:off + sz].split(b"\0")[0].decode("utf-8", "replace")
                off += sz
            elif t.startswith("bytes"):
                sz = int(t[5:])
                v = d[off:off + sz].hex()
                off += sz
            else:
                v, off = read_struct(d, off, t, offsets, f"{prefix}{n}" + (f"[{i}]" if c else "") + ".")
            vals.append(v)
        out[n] = vals if c else vals[0]
    return out, off


# ---------------------------------------------------------------- sections
class Sec:
    __slots__ = ("pos", "magic", "size", "child", "next", "attr", "bin", "count", "unk", "children", "attrs")

    def __init__(self, d, p):
        self.pos = p
        self.magic = d[p:p + 4].decode("latin1")
        (self.size, self.child, self.next, self.attr, self.bin, _pad, self.count, self.unk) = struct.unpack_from(
            "<IIIIIIHH", d, p + 4)
        self.children = []
        self.attrs = []

    def data_off(self):
        return self.pos + self.bin


def read_chain(d, p, count=None):
    out = []
    while True:
        s = Sec(d, p)
        out.append(s)
        if count is not None and len(out) >= count:
            break
        if s.next == NULL:
            break
        p += s.next
    return out


def read_emitter(d, s):
    if s.child != NULL:
        s.children = read_chain(d, s.pos + s.child, s.count)
        for c in s.children:
            read_emitter(d, c)
    if s.attr != NULL:
        s.attrs = read_chain(d, s.pos + s.attr)


class Vfxb:
    def __init__(self, path):
        self.path = path
        d = self.d = open(path, "rb").read()
        if d[:4] != b"VFXB":
            raise ValueError("not VFXB")
        (self.gfx_api, self.version, self.bom, self.align, self.target, self.name_off, self.flag, self.block_off,
         self.reloc, self.file_size) = struct.unpack_from("<HHHBBIHHII", d, 8)
        self.top = read_chain(d, self.block_off)
        self.by_magic = {s.magic: s for s in self.top}
        esta = self.by_magic["ESTA"]
        self.esets = read_chain(d, esta.pos + esta.child, esta.count) if esta.count else []
        for e in self.esets:
            e.children = read_chain(d, e.pos + e.child, e.count) if e.count else []
            for em in e.children:
                read_emitter(d, em)
        grtf = self.by_magic.get("GRTF")
        self.tex_desc = []
        self.bntx = None
        if grtf and grtf.count and grtf.child != NULL:
            gtnt = Sec(d, grtf.pos + grtf.child)
            self.tex_desc = self._desc_table(gtnt)
            if grtf.bin != NULL and grtf.size:
                self.bntx = d[grtf.pos + grtf.bin: grtf.pos + grtf.bin + grtf.size]
        g3pr = self.by_magic.get("G3PR")
        self.prim_desc = []
        self.bfres = None
        if g3pr and g3pr.count and g3pr.child != NULL:
            g3nt = Sec(d, g3pr.pos + g3pr.child)
            if g3nt.magic == "G3NT":
                self.prim_desc = self._desc_table(g3nt, raw=True)
            if g3pr.bin != NULL and g3pr.size:
                self.bfres = d[g3pr.pos + g3pr.bin: g3pr.pos + g3pr.bin + g3pr.size]
        self.esft = self._esft()

    def _desc_table(self, s, raw=False):
        """GTNT: {u64 id, u32 next, i32 len, char name[len]} / G3NT: 같은 틀에 이름 대신 8바이트(의미 미확정)."""
        d = self.d
        out = []
        p = s.pos + s.bin
        end = p + s.size
        while p < end:
            tid, nxt, ln = struct.unpack_from("<QIi", d, p)
            if raw:
                out.append({"id": tid, "name": "", "data": d[p + 16:p + 16 + ln].hex()})
            else:
                name = d[p + 16:p + 16 + ln].split(b"\0")[0].decode("utf-8", "replace")
                out.append({"id": tid, "name": name})
            if nxt == 0:
                break
            p += nxt
        return out

    def _esft(self):
        s = self.by_magic.get("ESFT")
        if not s or s.bin == NULL:
            return []
        d = self.d
        out = []
        p = s.pos + s.bin + 16  # 16바이트 머리(전부 0) 뒤에 {u32 next, i32 len, char path[len]}
        end = s.pos + s.bin + s.size
        while p < end:
            nxt, ln = struct.unpack_from("<Ii", d, p)
            out.append(d[p + 8:p + 8 + ln].split(b"\0")[0].decode("utf-8", "replace"))
            if nxt == 0:
                break
            p += nxt
        return out

    def eset_name(self, e):
        p = e.pos + e.bin
        return self.d[p + 16:p + 80].split(b"\0")[0].decode("utf-8", "replace")

    def eset_binary(self, e):
        p = e.pos + e.bin + 16 + 64
        return list(struct.unpack_from("<4I2I4I", self.d, p))

    def emitter(self, s, offsets=None):
        d = self.d
        end = s.attr if s.attr != NULL else s.size
        size = end - s.bin
        data, endoff = read_struct(d, s.pos + s.bin, emitter_struct(self.version), offsets)
        data["_binarySize"] = size
        data["_parsedSize"] = endoff - (s.pos + s.bin)
        return data

    def subsection(self, a):
        d = self.d
        raw = d[a.pos + a.bin: a.pos + a.size] if a.bin != NULL else b""
        out = {"magic": a.magic, "size": len(raw)}
        if a.magic.startswith("EA") and len(raw) >= 12:
            en, loop, rnd, _r, n, loopcount = struct.unpack_from("<4BII", raw, 0)
            keys = [list(struct.unpack_from("<4f", raw, 12 + 16 * i)) for i in range(n) if 12 + 16 * i + 16 <= len(raw)]
            out.update(enable=en, loop=loop, randomStart=rnd, loopCount=loopcount, keys=keys)
        else:
            out["f32"] = [round(x, 6) for x in struct.unpack_from(f"<{len(raw) // 4}f", raw, 0)]
            out["u32"] = list(struct.unpack_from(f"<{len(raw) // 4}I", raw, 0))
        return out


# ---------------------------------------------------------------- commands
def cmd_tree(path):
    v = Vfxb(path)
    print(f"VFXB gfxApi={v.gfx_api:#x} version={v.version} size={v.file_size} blockOff={v.block_off:#x}")
    for s in v.top:
        print(f"{s.pos:#08x} {s.magic} size={s.size:#x} count={s.count}")
    for e in v.esets:
        print(f"  ESET {v.eset_name(e)} emitters={e.count} bin={v.eset_binary(e)}")

        def walk(em, depth):
            data = v.emitter(em)
            print("    " * depth + f"EMTR {data['name']} attrs={[a.magic for a in em.attrs]} "
                                    f"bin={data['_binarySize']:#x} parsed={data['_parsedSize']:#x}")
            for c in em.children:
                walk(c, depth + 1)
        for em in e.children:
            walk(em, 2)
    print("textures:", [t["name"] for t in v.tex_desc])
    print("primitives:", [t["name"] for t in v.prim_desc])
    print("esft:", v.esft)


def summarize(v, data):
    """웹 시뮬레이션에 바로 쓰는 핵심 값만 뽑는다(전체 값은 raw 에 있다)."""
    st, em, pt, vel, col, sc, rs = (data["static"], data["emission"], data["particle"], data["velocity"],
                                    data["color"], data["scale"], data["render"])
    texmap = {t["id"]: t["name"] for t in v.tex_desc}
    primmap = {t["id"]: t["name"] for t in v.prim_desc}
    samplers = []
    for i, s in enumerate(data["samplers"]):
        if s["textureID"] in (0, 0xFFFFFFFFFFFFFFFF):
            continue
        samplers.append({"slot": i, "texture": texmap.get(s["textureID"], f"?{s['textureID']:#x}"),
                         "wrapU": s["wrapU"], "wrapV": s["wrapV"], "filter": s["filter"]})

    def keys(table, n):
        return [[round(k["x"], 5), round(k["y"], 5), round(k["z"], 5), round(k["time"], 5)] for k in table["keys"][:n]]

    return {
        "name": data["name"],
        "flag": f"{data['flag']:#x}",
        "calcType": data["info"]["calcType"], "followType": data["info"]["followType"],
        "emission": {k: em[k] for k in ("isOneTime", "start", "timing", "duration", "rate", "rateRandom", "interval",
                                        "intervalRandom", "positionRandom", "isWorldGravity")},
        "shape": {k: data["shape"][k] for k in ("volumeType", "sweepStart", "sweepLongitude", "sweepLatitude",
                                                "caliberRatio", "volumeRadiusX", "volumeRadiusY", "volumeRadiusZ",
                                                "volumeFormScaleX", "volumeFormScaleY", "volumeFormScaleZ",
                                                "numDivideCircle", "lineLength", "lineCenter", "isGpuEmitter")},
        "emitterTRS": {k: data["info"][k] for k in ("transX", "transY", "transZ", "rotateX", "rotateY", "rotateZ",
                                                    "scaleX", "scaleY", "scaleZ")},
        "emitterColor0": [data["info"][k] for k in ("color0R", "color0G", "color0B", "color0A")],
        "emitterColor1": [data["info"][k] for k in ("color1R", "color1G", "color1B", "color1A")],
        "life": pt["life"], "lifeRandom": pt["lifeRandom"], "infiniteLife": pt["infiniteLife"],
        "billboardType": pt["billboardType"], "rotType": pt["rotType"], "momentumRandom": pt["momentumRandom"],
        "primitive": primmap.get(pt["primitiveID"], None if pt["primitiveID"] in (0, 0xFFFFFFFFFFFFFFFF)
                                 else f"?{pt['primitiveID']:#x}"),
        "velocity": vel,
        "gravity": {"dir": [st["gravityDirX"], st["gravityDirY"], st["gravityDirZ"]], "scale": st["gravityScale"],
                    "emissionGravityScale": em["gravityScale"],
                    "emissionGravityDir": [em["gravityDirX"], em["gravityDirY"], em["gravityDirZ"]]},
        "airRes": st["airRes"],
        "rotateInit": [st["rotateInitX"], st["rotateInitY"], st["rotateInitZ"]],
        "rotateInitRand": [st["rotateInitRandX"], st["rotateInitRandY"], st["rotateInitRandZ"]],
        "rotateAdd": [st["rotateAddX"], st["rotateAddY"], st["rotateAddZ"]],
        "rotateAddRand": [st["rotateAddRandX"], st["rotateAddRandY"], st["rotateAddRandZ"]],
        "rotateRegist": st["rotateRegist"],
        "color": {"types": [col["color0Type"], col["alpha0Type"], col["color1Type"], col["alpha1Type"]],
                  "color0": [col["color0R"], col["color0G"], col["color0B"]], "alpha0": col["alpha0"],
                  "color1": [col["color1R"], col["color1G"], col["color1B"]], "alpha1": col["alpha1"],
                  "colorScale": st["colorScale"],
                  "color0Keys": keys(st["color0"], st["numColor0Keys"]),
                  "alpha0Keys": keys(st["alpha0"], st["numAlpha0Keys"]),
                  "color1Keys": keys(st["color1"], st["numColor1Keys"]),
                  "alpha1Keys": keys(st["alpha1"], st["numAlpha1Keys"])},
        "scale": {"base": [sc["scaleX"], sc["scaleY"], sc["scaleZ"]],
                  "random": [sc["scaleRandomX"], sc["scaleRandomY"], sc["scaleRandomZ"]],
                  "keys": keys(st["scaleAnim"], st["numScaleKeys"])},
        "render": {"blendType": rs["blendType"], "isBlendEnable": rs["isBlendEnable"], "isDepthTest": rs["isDepthTest"],
                   "isDepthMask": rs["isDepthMask"], "displaySide": rs["displaySide"], "isAlphaTest": rs["isAlphaTest"],
                   "alphaThreshold": rs["alphaThreshold"]},
        "combiner": {k: data["combiner"][k] for k in ("colorCombinerProcess", "alphaCombinerProcess",
                                                       "color0Interp", "alpha0Interp", "color1Interp",
                                                       "alpha1Interp", "scaleInterp") if k in data["combiner"]},
        "shaderIndex": data["shaderRef"]["shaderIndex"],
        "samplers": samplers,
        "texPattern": [{"num": st["texPatternAnim"][i]["num"], "frequency": st["texPatternAnim"][i]["frequency"],
                        "table": st["texPatternAnim"][i]["table"][:max(0, int(st["texPatternAnim"][i]["num"]))],
                        "type": data["texAnims"][i]["patternAnimType"]}
                       for i in range(len(data["texAnims"])) if data["texAnims"][i]["patternAnimType"]],
        "texUv": [{"slot": i, "repeat": data["texAnims"][i]["repeat"],
                   "uvScale": [st["texScrollAnim"][i]["uvScaleX"], st["texScrollAnim"][i]["uvScaleY"]],
                   "uvDiv": [st["texScrollAnim"][i]["uvDivX"], st["texScrollAnim"][i]["uvDivY"]],
                   "scrollAdd": [st["texScrollAnim"][i]["scrollAddX"], st["texScrollAnim"][i]["scrollAddY"]],
                   "isScroll": data["texAnims"][i]["isScroll"], "isRotate": data["texAnims"][i]["isRotate"],
                   "isScale": data["texAnims"][i]["isScale"]}
                  for i in (x["slot"] for x in samplers)],
        "drawPath": data["info"]["drawPath"],
        "userShaderDefine": data["shaderRef"]["userShaderDefine"],
        **(summarize_v40(data) if v.version == 40 else {}),
    }


def summarize_v40(data):
    """[mps v40] 웹 런타임이 더 쓰는 값: 페이드·루프·패턴·흔들림·회전 플래그·셰이더 표지 (08_effects.md 4.3)."""
    st, info, pt, em = data["static"], data["info"], data["particle"], data["emission"]
    return {
        "fade": {k: info[k] for k in ("isFadeEmit", "isAlphaFadeIn", "isScaleFadeIn", "isAlphaFadeOut",
                                      "isScaleFadeOut", "alphaFadeTime", "fadeInTime")},
        "emitterTransRand": [info["transRandX"], info["transRandY"], info["transRandZ"]],
        "emitterRotateRand": [info["rotateRandX"], info["rotateRandY"], info["rotateRandZ"]],
        "emission2": {k: em[k] for k in ("isEmitDistEnabled", "isWorldOrientedVelocity", "emitterDistUnit",
                                         "emitterDistMin", "emitterDistMax", "emitterDistMarg")},
        "shape2": {k: data["shape"][k] for k in ("arcType", "sweepStartRandom", "isVolumeLatitudeEnabled",
                                                 "volumeLatitudeDir", "volumeSurfacePosRand", "primEmitType",
                                                 "numDivideLine")},
        "loop": {k: pt[k] for k in ("loopColor0", "loopAlpha0", "loopColor1", "loopAlpha1", "scaleLoop",
                                    "loopRandomColor0", "loopRandomAlpha0", "loopRandomColor1", "loopRandomAlpha1",
                                    "scaleLoopRandom", "color0LoopRate", "alpha0LoopRate", "color1LoopRate",
                                    "alpha1LoopRate", "scaleLoopRate")},
        "rotateFlags": {k: pt[k] for k in ("isRotateX", "isRotateY", "isRotateZ", "rotRevRandX", "rotRevRandY",
                                           "rotRevRandZ", "offsetType")},
        "texPatternV40": [{"type": data["texAnims"][i]["patternAnimType"],
                           "num": st["texPatternAnim"][i]["num"], "frequency": st["texPatternAnim"][i]["frequency"],
                           "numRandom": st["texPatternAnim"][i]["numRandom"],
                           "table": st["texPatternAnim"][i]["table"],
                           "div": [st["texScrollAnim"][i]["uvDivX"], st["texScrollAnim"][i]["uvDivY"]],
                           "isPatAnimLoopRandom": data["texAnims"][i]["isPatAnimLoopRandom"]} for i in range(3)],
        "fluctuation": {**{k: data["fluctuation"][k] for k in ("isApplyAlpha", "isApplyScale", "isApplyScaleY",
                                                                "isWaveType", "isPhaseRandomX", "isPhaseRandomY")},
                        **{k: st[k] for k in ("amplitudeX", "amplitudeY", "cycleX", "cycleY", "phaseRndX",
                                              "phaseRndY", "phaseInitX", "phaseInitY")}},
        "softParticle": {"enabled": data["color"]["isSoftParticle"], "dist": st["softParticleDist"],
                         "volume": st["softParticleVolume"]},
        "computeShaderIndex": data["shaderRef"]["computeShaderIndex"],
        "customShaderIndex": data["shaderRef"]["customShaderIndex"],
        "actionIndex": data["action"]["actionIndex"],
        "inherit": {k: data["inherit"][k] for k in ("velocity", "scale", "rotate", "color0", "color1", "alpha0",
                                                    "alpha1", "childEmitByParentTime", "velocityRate", "scaleRate")},
    }


def emitter_json(v, s):
    data = v.emitter(s)
    return {
        "summary": summarize(v, data),
        "subsections": [v.subsection(a) for a in s.attrs],
        "children": [emitter_json(v, c) for c in s.children],
        "raw": data,
    }


def cmd_dump(path, out_dir, png=False):
    v = Vfxb(path)
    os.makedirs(out_dir, exist_ok=True)
    doc = {
        "source": path.replace("\\", "/"),
        "tool": "tools/effect_vfxb.py",
        "header": {"gfxApi": v.gfx_api, "version": v.version, "fileSize": v.file_size},
        "sections": [{"magic": s.magic, "pos": s.pos, "size": s.size, "count": s.count} for s in v.top],
        "esft": v.esft,
        "textures": [{"id": f"{t['id']:#018x}", "name": t["name"]} for t in v.tex_desc],
        "primitives": [{"id": f"{t['id']:#018x}", "data": t.get("data")} for t in v.prim_desc],
        "emitterSets": [],
    }
    for e in v.esets:
        doc["emitterSets"].append({
            "name": v.eset_name(e), "binary": v.eset_binary(e),
            "emitters": [emitter_json(v, em) for em in e.children],
        })
    with open(os.path.join(out_dir, "vfxb.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1, default=lambda o: o if not isinstance(o, int) else o)
    if v.bntx:
        open(os.path.join(out_dir, "textures.bntx"), "wb").write(v.bntx)
    if v.bfres:
        open(os.path.join(out_dir, "primitives.bfres"), "wb").write(v.bfres)
    if png and v.bntx:
        sys.path.insert(0, HERE)
        import graphics_bntx  # graphics 담당 도구(BNTX 4.1 디스위즐·디코드)
        tex_dir = os.path.join(out_dir, "tex")
        os.makedirs(tex_dir, exist_ok=True)
        graphics_bntx.cmd_png(tex_dir, [os.path.join(out_dir, "textures.bntx")])
    print(f"{path}: {len(doc['emitterSets'])} emitter sets, {len(doc['textures'])} textures -> {out_dir}")


def iter_emitters(v):
    for e in v.esets:
        stack = [(em, 0) for em in e.children]
        while stack:
            em, depth = stack.pop(0)
            yield e, em, depth
            stack.extend((c, depth + 1) for c in em.children)


def cmd_check(root):
    files = glob.glob(os.path.join(root, "**", "_Vfx", "**", "ConvertList.xml"), recursive=True)
    files += glob.glob(os.path.join(root, "**", "effect", "*.xml"), recursive=True)  # [mps] <x>/effect/effect.xml
    stats = {"files": 0, "esets": 0, "emitters": 0, "children": 0, "sizeMismatch": 0, "badTexId": 0, "texRefs": 0,
             "badName": 0, "attrMagic": {}, "binSizes": {}, "billboard": {}, "blend": {}, "volume": {}, "calcType": {},
             "versions": {}, "badPrim": 0, "primRefs": 0, "keyTables": 0, "keyTimeBad": 0, "keyTailNonzero": 0}
    sizes = {53: struct_size("EmitterData"), 40: struct_size("EmitterDataV40")}
    for f in sorted(files):
        v = Vfxb(f)
        stats["files"] += 1
        stats["versions"][v.version] = stats["versions"].get(v.version, 0) + 1
        stats["esets"] += len(v.esets)
        texids = {t["id"] for t in v.tex_desc}
        primids = {t["id"] for t in v.prim_desc}
        for e, em, depth in iter_emitters(v):
            stats["emitters"] += 1
            if depth:
                stats["children"] += 1
            data = v.emitter(em)
            if data["_binarySize"] != sizes.get(v.version, -1):
                stats["sizeMismatch"] += 1
            b = data["_binarySize"]
            stats["binSizes"][b] = stats["binSizes"].get(b, 0) + 1
            if not data["name"] or not data["name"].isprintable():
                stats["badName"] += 1
            for s in data["samplers"]:
                if s["textureID"] not in (0, 0xFFFFFFFFFFFFFFFF):
                    stats["texRefs"] += 1
                    if s["textureID"] not in texids:
                        stats["badTexId"] += 1
            pid = data["particle"]["primitiveID"]
            if pid not in (0, 0xFFFFFFFFFFFFFFFF):
                stats["primRefs"] += 1
                if pid not in primids:
                    stats["badPrim"] += 1
            st = data["static"]
            for tab, nk in (("color0", "numColor0Keys"), ("alpha0", "numAlpha0Keys"), ("color1", "numColor1Keys"),
                            ("alpha1", "numAlpha1Keys"), ("scaleAnim", "numScaleKeys")):
                ks = st[tab]["keys"]
                n = st[nk]
                ts = [k["time"] for k in ks[:n]]
                stats["keyTables"] += 1
                if n > 8 or any(not (0 <= t <= 1.0001) for t in ts) or any(ts[i] > ts[i + 1] for i in range(len(ts) - 1)):
                    stats["keyTimeBad"] += 1
                if any(k["x"] or k["y"] or k["z"] or k["time"] for k in ks[n:]):
                    stats["keyTailNonzero"] += 1
            for a in em.attrs:
                stats["attrMagic"][a.magic] = stats["attrMagic"].get(a.magic, 0) + 1
            for key, val in (("billboard", data["particle"]["billboardType"]), ("blend", data["render"]["blendType"]),
                             ("volume", data["shape"]["volumeType"]), ("calcType", data["info"]["calcType"])):
                stats[key][val] = stats[key].get(val, 0) + 1
    stats["emitterDataSize"] = {k: hex(x) for k, x in sizes.items()}
    for k in ("attrMagic", "binSizes", "billboard", "blend", "volume", "calcType", "versions"):
        stats[k] = dict(sorted(stats[k].items(), key=lambda kv: -kv[1]))
    print(json.dumps(stats, indent=1, default=str))


def cmd_find(root, name):
    files = glob.glob(os.path.join(root, "**", "_Vfx", "**", "ConvertList.xml"), recursive=True)
    files += glob.glob(os.path.join(root, "**", "effect", "*.xml"), recursive=True)  # [mps]
    for f in sorted(files):
        v = Vfxb(f)
        for e in v.esets:
            if v.eset_name(e) == name:
                print(f, e.count)


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    if a[0] == "tree":
        cmd_tree(a[1])
    elif a[0] == "dump":
        cmd_dump(a[1], a[2], "--png" in a)
    elif a[0] == "check":
        cmd_check(a[1])
    elif a[0] == "find":
        cmd_find(a[1], a[2])
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
