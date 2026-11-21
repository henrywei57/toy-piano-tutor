// The parts of TensorFlow.js that Basic Pitch needs: the core ops, the graph
// model loader, and the WebGL (graphics card) and CPU backends. Basic Pitch
// imports "@tensorflow/tfjs"; vite.config.js points that import here, which
// leaves out the much larger layers and data packages.

import '@tensorflow/tfjs-core';
// Tensor methods like tensor.slice() (Basic Pitch uses them). The full
// @tensorflow/tfjs package registers these; tfjs-core on its own does not.
import '@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';

export * from '@tensorflow/tfjs-core';
export * from '@tensorflow/tfjs-converter';
