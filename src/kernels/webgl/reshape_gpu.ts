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
import {getChannels, getInnerDims} from '../packing_util';

export class ReshapeProgram implements GPGPUProgram {
  variableNames = ['A'];
  usesPackedTextures = true;
  outputShape: number[];
  userCode: string;

  constructor(outputShape: number[], inputShape: number[]) {
    this.outputShape = outputShape;
    const rank = outputShape.length;
    const dtype = getCoordsDataType(rank);
    const shapeInnerDims = outputShape.slice(-2);
    const innerDims = getInnerDims(rank, getChannels('thisRC'));

    const inputRank = inputShape.length;
    const inputDtype = getCoordsDataType(inputRank);
    const inputChannels = getChannels('inputRC').slice(0, inputRank);

    this.userCode = `
      ${getReshapedInputCoords(inputRank)}
      ${getFlatIndex(outputShape)}

      void main() {
        ${dtype} rc = getOutputCoords();

        vec4 result = vec4(0.);

        for(int row=0; row<=1; row++) {
          for(int col=0; col<=1; col++) {
            ${dtype} thisRC = rc;
            ${innerDims[0]} += row;
            ${innerDims[1]} += col;

            if(${innerDims[0]} >= ${shapeInnerDims[0]} || ${innerDims[1]} >= ${shapeInnerDims[1]}) continue;

            int flatIndex = getFlatIndex(thisRC);

            ${inputDtype} inputRC = inputCoordsFromReshapedOutCoords(flatIndex);

            result[row * 2 + col] = getA(${inputChannels});
          }
        }

        setOutput(result);
      }
    `;
  }
}

function getFlat1DIndex(): string {
  return `int getFlatIndex(int coords) {
    return coords;
  }`;
}

function getFlat2DIndex(shape: number[]): string {
  return `int getFlatIndex(vec2 coords) {
    return coords.x * ${shape[1]} + coords.y;
  }`;
}

function getFlat3DIndex(shape: number[]): string {
  const stride1 = shape[2];
  const stride0 = shape[1] * stride1;

  return `int getFlatIndex(vec3 coords) {
    return coords.x * ${stride0} + coords.y * ${stride1} + coords.z;
  }`;
}

function getFlat4DIndex(shape: number[]): string {
  const stride2 = shape[3];
  const stride1 = shape[2] * stride2;
  const stride0 = shape[1] * stride1;

  return `int getFlatIndex(vec4 coords) {
    return coords.x * ${stride0} + coords.y * ${stride1} + coords.z * ${stride2} + coords.w;
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
    default:
      throw new Error(`Packed ${shape.length}-D flat indexing is not yet supported`);
  }
}

function getReshaped1DInputCoords(): string {
  return ``;
}

function getReshaped2DInputCoords(): string {
  return `vec2 inputCoordsFromReshapedOutCoords(int flatIndex) {

  }`;
}

function getReshapedInputCoords(inputRank: number): string {
  switch(inputRank) {
    case 1:
      return getReshaped1DInputCoords(inputRank);
    case 2:
      return getReshaped2DInputCoords(inputRank);
    default:
      throw new Error(`Packed ${inputRank}-D reshaping` +
          ` is not yet supported`);
  }
}