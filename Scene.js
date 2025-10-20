// Spencer Lee
// Midterm Scene

const shaderSource = `
    struct Uniforms {
      color: vec4f,
      matrix: mat4x4f,
    };

    @group(0) @binding(0) var<uniform> uni: Uniforms;

    struct VSOutput {
        @builtin(position) position : vec4f,
    };
    @vertex
    fn vertexMain(@location(0) position: vec3f) -> VSOutput {
        var vsOut: VSOutput;
        vsOut.position = uni.matrix * vec4f(position, 1.0);
        return vsOut;
    }

    @fragment
    fn fragmentMain(vsOut: VSOutput) -> @location(0) vec4f 
    {
        return uni.color;
    }
   `
   ;

let context;  // The WebGPU context for the canvas, where the image is displayed.
let device;   // The WebGPU device, used for all interaction with the GPU.

let shader;   // The shader program, compiled from shaderSource constant, given above.
let pipeline; // Specifies shader stages for the render pass encoder.

let canvasFormat;

let depthTexture; // Depth buffer

let vertexBuffers = [];         // array of VBOs, one per shape
let indexBuffers = [];
let nVertsPerShape = [];        // numbers od vertices for each shape

let bottom = -150.0;
let upper  =  150.0;
let left   = -150.0;
let right  =  150.0;

const nInstances = 1 + (2 * 25);
const IntanceData = [];

let yaw = 0;
let pitch = 0;
let eyeZ = 150;
let aspect;
let fov = 45;
let moveRight = 0;

// offsets to the various uniform values in float32 indices
const kColorOffset = 0;
const kMatrixOffset = 4;

const degToRad = d => d * Math.PI / 180;

/* Obtain the WebGPU device, or throw an error if WebGPU can't be initialized.
 * Also, contain and configure the canvas, and compile the shader program.
 * This is an "async" function because it uses "await", and it is called
 * with "await" in the init() function below.
 */
async function initWebGPU() {

   // A "device" is central to using WebGPU.  It is always obtained
   // in the same way.

   if (!navigator.gpu) {
      throw Error("WebGPU not supported in this browser.");
   }
   let adapter = await navigator.gpu.requestAdapter();
   if (!adapter) {
      throw Error("WebGPU is supported, but couldn't get WebGPU adapter.");
   }

   device = await adapter.requestDevice();
   
   // For display on the screen. WebGPU draws to an HTML canvas element
   // on the web page.  You need to call canvas.getContext("webgpu")
   // and then configure the canvas to use the WebGPU device.  This
   // is always done in the same way, except possibly for alphaMode.
   
   let canvas = document.getElementById("webgpuCanvas");

   // Account for canvas aspect ratio
   aspect = canvas.width / canvas.height;
   left   = bottom * aspect;
   right  = upper * aspect;

   context = canvas.getContext("webgpu");

   canvasFormat = navigator.gpu.getPreferredCanvasFormat();
     
   context.configure({
      device: device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied"  // Alternative is "opaque", which is the default.
                                  // Setting it to "premultiplied" allows pixels
                                  // in the canvas to be translucent.
   });

   // The depth test requires a texture, which serves as the depth buffer.
   // It becomes part of the color attachment for the pipeline.
   depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT
   })

   // Compile the shader source code, checking for any errors in the code.
   
   device.pushErrorScope("validation");
   shader = device.createShaderModule({
      code: shaderSource
   });
   let error = await device.popErrorScope();
   if (error) {
      throw Error("Compilation error in shader; see Console for details.");
   }   
}

// Setup pipeline

function pipelineSetUp()
{
  let vertexBufferLayout = [
        {
            arrayStride: 3 * 4,  // x, y, z (3 atts * 4 bytes each)
            attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },  
            ]
        }
    ];
 
   let pipelineDescriptor = {
      label: '3D Boxes Pipe',
      layout: 'auto',
      vertex: { 
         module: shader,  
         entryPoint: "vertexMain",  
         buffers: vertexBufferLayout  
      },
      fragment: { 
         module: shader, 
         entryPoint: "fragmentMain", 
         targets: [{
             format: navigator.gpu.getPreferredCanvasFormat()
         }]
      },
      primitive: {  
         topology: "triangle-list",
         cullMode: "back"
         //topology: "line-strip"
      },
      depthStencil: { //enable the depth test for this pipeline
         depthWriteEnabled: true,
         depthCompare: "less",
         format: "depth24plus",
      }
   };
   pipeline = device.createRenderPipeline(pipelineDescriptor); // Create the pipline 
}

////////////////// createBox
function createBoxIndexed()
  {
    const boxVertexData = new Float32Array([
       // Top
       -0.5,  0.5,  0.5, // 0
        0.5,  0.5,  0.5, // 1
        0.5,  0.5, -0.5, // 2
       -0.5,  0.5, -0.5, // 3

       // Bottom
       -0.5, -0.5,  0.5, // 4
        0.5, -0.5,  0.5, // 5
        0.5, -0.5, -0.5, // 6
       -0.5, -0.5, -0.5, // 7

    ]);

    // Used to trace out the vertices order of each triangle
    const boxIndexData = new Uint32Array([
      // Front
      0, 4, 1,
      4, 5, 1,

      // Back
      3, 2, 7,
      2, 6, 7,

      // Top
      0, 1, 3,
      3, 1, 2,

      // Bottom
      4, 7, 6,
      4, 6, 5,

      // Right
      1, 5, 6,
      6, 2, 1,

      // Left
      4, 0, 7,
      7, 0, 3,
    ]);

  return {
    boxVertexData,
    boxIndexData,
    box_nVertices: boxIndexData.length,
  };
}

////////////////// End createBox

// Creates a tree - returns the index of the next object
function createTree(offsetIndex, offsetPosition) {
   let size = Math.random() * 20;
   IntanceData[offsetIndex].xForm.translation = [0 + offsetPosition[0],  25.0 - (size/2) + offsetPosition[1], 0 + offsetPosition[2]];
   IntanceData[offsetIndex].xForm.scale       = [ 10.0, 45.0 + size, 10.0];
   IntanceData[offsetIndex].uniformValues.subarray(kColorOffset, kColorOffset + 4).set([0.25, 0.25, 0.0, 1]);

   IntanceData[offsetIndex + 1].xForm.translation = [0 + offsetPosition[0],  -15.0 - (size/2) + offsetPosition[1], 0.0 + offsetPosition[2]];
   IntanceData[offsetIndex + 1].xForm.scale       = [ 40.0 + (size/2), 40.0 + (size/2), 40.0 + (size/2)];
   IntanceData[offsetIndex + 1].uniformValues.subarray(kColorOffset, kColorOffset + 4).set([0.1, 0.8, 0.1, 1]);
   return offsetIndex + 2;
}

function geomSetUp()
{
   const {boxVertexData, boxIndexData, box_nVertices } = createBoxIndexed();


   const boxVertexBuffer = device.createBuffer({
     label: 'vertex buffer vertices',
     size: boxVertexData.byteLength,
     usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
   });
   device.queue.writeBuffer(boxVertexBuffer, 0, boxVertexData);

   vertexBuffers.push(boxVertexBuffer);
   nVertsPerShape.push(box_nVertices);

   console.log("nVertsPerShape[0] = " + nVertsPerShape[0]);

   // Indices Buffer
  const boxIndexBuffer = device.createBuffer({
    label: 'index buffer',
    size: boxIndexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(boxIndexBuffer, 0, boxIndexData);

  indexBuffers.push(boxIndexBuffer);

   //////////////////////////////// Uniform Buffers Creation

   for (let i = 0; i < nInstances; ++i) {
     // color, matrix
     const uniformBufferSize = (4 + 16) * 4;      // (rgba + 4x4 matrix) * 4 bytes
     const uniformBuffer = device.createBuffer({
       label: 'uniforms',
       size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
     }); 

     // Holder for 4 color values for rgba & 16 matrix values for 4x4 matrix
     const uniformValues = new Float32Array(uniformBufferSize / 4);

     const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);
     const matrixValue = uniformValues.subarray(kMatrixOffset, kMatrixOffset + 16);

     // The color will not change so let's set it once at init time
     colorValue.set([Math.random(), Math.random(), Math.random(), 1]);

     const bindGroup = device.createBindGroup({
       label: 'bind group for shape instance',
       layout: pipeline.getBindGroupLayout(0),
       entries: [
         { binding: 0, resource: { buffer: uniformBuffer }},
       ],
     });

     const xForm = {
       translation: [0, 0, 0],
       rotation: [degToRad(0), degToRad(0), degToRad(0)],
       scale: [1, 1, 1],
     };

     IntanceData.push({uniformBuffer,uniformValues,matrixValue,bindGroup,xForm});
   }

   // Add floor
   IntanceData[0].xForm.translation = [ 0.0,  50.0, 0.0];
   IntanceData[0].xForm.scale       = [ 1000.0, 1.0, 1000.0];
   IntanceData[0].uniformValues.subarray(kColorOffset, kColorOffset + 4).set([0, 0.75, 0, 1]);

   // Add trees
   for (let i = 0; i < 25; i++) {
      createTree(1 + (i * 2), [(Math.random() * 500) - 250, 0, (Math.random() * 500) - 250])
   }


}
// End of geomSetUp

/// Render

function render() {
   let commandEncoder = device.createCommandEncoder();

   const renderPassDescriptor = { // GPURenderPassDescriptor 
        colorAttachments: [ { 
          view    : context.getCurrentTexture().createView(),
          loadOp  : "clear", 
          clearValue: { r: 0, g: 0.9, b: 0.9, a: 1 },
          storeOp : 'store' 
        } ],
        depthStencilAttachment: { // Add depth buffer to the colorAttachment
            view : depthTexture.createView(),
            depthClearValue : 1.0,
            depthLoadOp : "clear",
            depthStoreOp : "store",
         }  
     };
   const pass = commandEncoder.beginRenderPass(renderPassDescriptor);

   // Draw the geometry.
   pass.setPipeline(pipeline);

   pass.setVertexBuffer(0, vertexBuffers[0]); // only one shape (unit Box) to draw
   pass.setIndexBuffer(indexBuffers[0], 'uint32');


   for (const {uniformBuffer, uniformValues, matrixValue, bindGroup, xForm} of IntanceData) 
   {
      // Perspective Projection matrix
      mat4.perspective(degToRad(fov), aspect, 0.1, 1000, matrixValue);

      // Build View Matrix
      mat4.rotateZ(matrixValue, degToRad(180), matrixValue);
      mat4.translate(matrixValue, [moveRight, 0, -eyeZ], matrixValue);
      mat4.rotateY(matrixValue, degToRad(yaw), matrixValue);
      mat4.rotateX(matrixValue, degToRad(pitch), matrixValue);

      // Build Model (instance) Matrix
      mat4.translate(matrixValue, xForm.translation, matrixValue);
      mat4.rotateX(matrixValue, xForm.rotation[0], matrixValue);
      mat4.rotateY(matrixValue, xForm.rotation[1], matrixValue);
      mat4.rotateZ(matrixValue, xForm.rotation[2], matrixValue);
      mat4.scale(matrixValue, xForm.scale, matrixValue);

      // upload the uniform values to the uniform buffer
      device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
      pass.setBindGroup(0, bindGroup);
      pass.drawIndexed(nVertsPerShape[0]); // only one shape (unit square) to draw
   }

   pass.end();
   device.queue.submit([commandEncoder.finish()]);

   requestAnimationFrame(render);    // Animation 
}

// Callback function for keydown events, rgeisters function dealWithKeyboard
window.addEventListener("keydown", dealWithKeyboard, false);

// Functions that gets called to parse keydown events
function dealWithKeyboard(e) {
    switch (e.keyCode) {
       case 65: // move left - a
            {
               moveRight -= 1;
            }
       break;
       case 68: // move right - d
            {
               moveRight += 1;
            }
       break;
       case 87: // W - Move forward
            {
               eyeZ -= 1;
            }
        break;
        case 83: // S - Move backward
            {
               eyeZ += 1;
            }
        break;
       case 37: // left arrow move left
            {
                yaw -= 1.0;
            };
       break;
       case 38: // up arrow move up
            {
                pitch -= 1.0;
                console.log("pitch " + pitch);
            };
       break;
       case 39: // right arrow move right
            {
              yaw += 1.0;
            };    
       break;
       case 40: // down arrow move down
            {
              pitch += 1.0;
              console.log("pitch " + pitch);
            };
       break;
       case 90:
            {
               fov -= 1;
               fov = Math.max(1, fov);
            }
       break;
       case 67:
            {
               fov += 1;
               fov = Math.min(179, fov);
            }
       break;
    }
}

/* This function is called after the web page has been loaded.  It does
 * initialization and calls draw() to draw the initial image in the canvas.
 */
async function init() {
   try {
      await initWebGPU();
      pipelineSetUp();
   }
   catch (e) {
       document.getElementById("message").innerHTML =
          "<span style='color:#AA0000; font-size:110%'><b>Error: Could not initialize WebGPU: </b>" + 
                    e.message + "</span>";
       return;
   }
   geomSetUp();
   render();
}

window.onload = init;  // arrange for init() to be called after loading the page

