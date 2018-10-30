/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {GPGPUProgram} from './gpgpu_math';
import {getCoordsDataType} from './shader_compiler';
import {getChannels} from '../packing_util';

export class ReshapePackedProgram implements GPGPUProgram {
  variableNames = ['A'];
  usesPackedTextures = true;
  outputShape: number[];
  userCode: string;

  constructor(outputShape: number[], inputShape: number[]) {
    this.outputShape = outputShape;
    const rank = outputShape.length;
    const dtype = getCoordsDataType(rank);
    const innerDims = getChannels('thisRC', rank).slice(-2);

    const inputRank = inputShape.length;
    const inputDtype = getCoordsDataType(inputRank);
    const inputChannels = getChannels('inputRC', inputRank);
    const inputInnerDimsDtype = inputRank === 1 ? 'float' : 'vec2';

    let inputInnerDimsString = '', offset = '', inputChannelOffset = '', input = '';
    if(inputRank === 1) {
      inputInnerDimsString = 'float(inputRCTopLeft)';
      inputChannelOffset = `inputRC - inputRCTopLeft`;
      input = `getA(${inputChannels})`;
    } else {
      const inputTopLeftInnerDims = getChannels('inputRCTopLeft', inputRank).slice(-2);
      inputInnerDimsString = `vec2(float(${inputTopLeftInnerDims[0]}), float(${inputTopLeftInnerDims[1]}))`;
      offset = `int offset = modInputInnerDims.x == 0. ?
          (modInputInnerDims.y == 0. ? 0 : 1) :
          (modInputInnerDims.y == 0. ? 2 : 3)`;

      const inputInnerDims = inputChannels.slice(-2);
      inputChannelOffset = `(${inputInnerDims[0]} - ${inputTopLeftInnerDims[0]}) * 2 + (${inputInnerDims[1]} - ${inputTopLeftInnerDims[1]})`;
      input = `getChannel(getA(${inputChannels}), offset + ${inputChannelOffset})`;
    }

    const mainLoop = getMainLoop(dtype, innerDims, outputShape.slice(-2), inputDtype, input);

    this.userCode = `
      ${getReshapedInputCoords(inputShape)}
      ${getFlatIndex(outputShape)}

      float getChannel(vec4 frag, int index) {
        int mod = int(mod(float(index), 4.));
        if(mod == 0) return frag.x;
        if(mod == 1) return frag.y;
        if(mod == 2) return frag.z;
        return frag.w;
      }

      void main() {
        ${dtype} rc = getOutputCoords();

        vec4 result = vec4(0.);
        ${inputDtype} inputRCTopLeft = inputCoordsFromReshapedOutCoords(getFlatIndex(rc));
        ${inputInnerDimsDtype} inputInnerDims = ${inputInnerDimsString};
        ${inputInnerDimsDtype} modInputInnerDims = mod(inputInnerDims, 2.);

        ${offset};

        ${mainLoop}

        setOutput(result);
      }
    `;
  }
}

function getMainLoop(dtype: string, innerDims: string[], shapeInnerDims: number[], inputDtype: string, input: string) {
  if(dtype === 'int') {
    return `
      for(int col=0; col<=1; col++) {
        ${dtype} thisRC = rc + col;

        if(${innerDims[0]} >= ${shapeInnerDims[0]}) continue;

        int flatIndex = getFlatIndex(thisRC);

        ${inputDtype} inputRC = inputCoordsFromReshapedOutCoords(flatIndex);
        result[col] = ${input};
      }
    `;
  }
  return `
    for(int row=0; row<=1; row++) {
      for(int col=0; col<=1; col++) {
        ${dtype} thisRC = rc;
        ${innerDims[0]} += row;
        ${innerDims[1]} += col;

        if(${innerDims[0]} >= ${shapeInnerDims[0]} || ${innerDims[1]} >= ${shapeInnerDims[1]}) continue;

        int flatIndex = getFlatIndex(thisRC);

        ${inputDtype} inputRC = inputCoordsFromReshapedOutCoords(flatIndex);

        result[row * 2 + col] = ${input};
      }
    }
  `;
}

function getFlat1DIndex(): string {
  return `int getFlatIndex(int coords) {
    return coords;
  }`;
}

function getFlat2DIndex(shape: number[]): string {
  return `int getFlatIndex(ivec2 coords) {
    return coords.x * ${shape[1]} + coords.y;
  }`;
}

function getFlat3DIndex(shape: number[]): string {
  const stride1 = shape[2];
  const stride0 = shape[1] * stride1;

  return `int getFlatIndex(ivec3 coords) {
    return coords.x * ${stride0} + coords.y * ${stride1} + coords.z;
  }`;
}

function getFlat4DIndex(shape: number[]): string {
  const stride2 = shape[3];
  const stride1 = shape[2] * stride2;
  const stride0 = shape[1] * stride1;

  return `int getFlatIndex(ivec4 coords) {
    return coords.x * ${stride0} + coords.y * ${stride1} + coords.z * ${stride2} + coords.w;
  }`;
}

function getFlat5DIndex(shape: number[]): string {
  const stride3 = shape[4];
  const stride2 = shape[3] * stride3;
  const stride1 = shape[2] * stride2;
  const stride0 = shape[1] * stride1;

  return `int getFlatIndex(ivec5 coords) {
    return coords.x * ${stride0} + coords.y * ${stride1} + coords.z * ${stride2} + coords.w * ${stride3} + coords.u;
  }`;
}

function getFlat6DIndex(shape: number[]): string {
  const stride4 = shape[5];
  const stride3 = shape[4] * stride4;
  const stride2 = shape[3] * stride3;
  const stride1 = shape[2] * stride2;
  const stride0 = shape[1] * stride1;

  return `int getFlatIndex(ivec5 coords) {
    return coords.x * ${stride0} + coords.y * ${stride1} + coords.z * ${stride2} + coords.w * ${stride3} + coords.u * ${stride4} + coords.v;
  }`;
}

function getFlatIndex(shape: number[]): string {
  switch(shape.length) {
    case 1:
      return getFlat1DIndex();
    case 2:
      return getFlat2DIndex(shape);
    case 3:
      return getFlat3DIndex(shape);
    case 4:
      return getFlat4DIndex(shape);
    case 5:
      return getFlat5DIndex(shape);
    case 6:
      return getFlat6DIndex(shape);
    default:
      throw new Error(`Packed ${shape.length}-D flat indexing is not yet supported`);
  }
}

function getReshaped1DInputCoords(shape: [number]): string {
  return `int inputCoordsFromReshapedOutCoords(int index) {
    return index;
  }`;
}

function getReshaped2DInputCoords(shape: [number, number]): string {
  return `ivec2 inputCoordsFromReshapedOutCoords(int index) {
    int r = index / ${shape[1]};
    int c = index - r * ${shape[1]};
    return ivec2(r, c);
  }`;
}

function getReshaped3DInputCoords(shape: [number, number, number]): string {
  const stride0 = shape[1] * shape[2];
  const stride1 = shape[2];

  return `ivec3 inputCoordsFromReshapedOutCoords(int index) {
    int r = index / ${stride0};
    index -= r * ${stride0};
    int c = index / ${stride1};
    int d = index - c * ${stride1};
    return ivec3(r, c, d);
  }`;
}

function getReshaped4DInputCoords(shape: [number, number, number, number]): string {
  const stride2 = shape[3];
  const stride1 = shape[2] * stride2;
  const stride0 = shape[1] * stride1;

  return `
    ivec4 inputCoordsFromReshapedOutCoords(int index) {
      int r = index / ${stride0};
      index -= r * ${stride0};

      int c = index / ${stride1};
      index -= c * ${stride1};

      int d = index / ${stride2};
      int d2 = index - d * ${stride2};

      return ivec4(r, c, d, d2);
    }
  `;
}

function getReshaped5DInputCoords(
    shape: [number, number, number, number, number]): string {
  const stride3 = shape[4];
  const stride2 = shape[3] * stride3;
  const stride1 = shape[2] * stride2;
  const stride0 = shape[1] * stride1;
  return `
    ivec5 inputCoordsFromReshapedOutCoords(int index) {
      int r = index / ${stride0};
      index -= r * ${stride0};

      int c = index / ${stride1};
      index -= c * ${stride1};

      int d = index / ${stride2};
      index -= d * ${stride2};

      int d2 = index  / ${stride3};
      int d3 = index - d2 * ${stride3};

      return ivec5(r, c, d, d2, d3);
    }
  `;
}

function getReshaped6DInputCoords(
    shape: [number, number, number, number, number, number]): string {
  const stride4 = shape[5];
  const stride3 = shape[4] * stride4;
  const stride2 = shape[3] * stride3;
  const stride1 = shape[2] * stride2;
  const stride0 = shape[1] * stride1;

  return `
    ivec6 inputCoordsFromReshapedOutCoords(int index) {
      int r = index / ${stride0};
      index -= r * ${stride0};

      int c = index / ${stride1};
      index -= c * ${stride1};

      int d = index / ${stride2};
      index -= d * ${stride2};

      int d2 = index / ${stride3};
      index -= d2 * ${stride3};

      int d3 = index / ${stride4};
      int d4 = index - d3 * ${stride4};

      return ivec6(r, c, d, d2, d3, d4);
    }
  `;
}

function getReshapedInputCoords(shape: number[]): string {
  switch(shape.length) {
    case 1:
      return getReshaped1DInputCoords(shape as [number]);
    case 2:
      return getReshaped2DInputCoords(shape as [number, number]);
    case 3:
      return getReshaped3DInputCoords(shape as [number, number, number]);
    case 4:
      return getReshaped4DInputCoords(shape as [number, number, number, number]);
    case 5:
      return getReshaped5DInputCoords(shape as [number, number, number, number, number]);
    case 5:
      return getReshaped6DInputCoords(shape as [number, number, number, number, number, number]);
    default:
      throw new Error(`Packed ${shape.length}-D reshaping` +
          ` is not yet supported`);
  }
}