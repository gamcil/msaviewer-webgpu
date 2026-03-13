export class MSARenderer {
    constructor(device, canvasFormat, shaderCode) {
        this.device = device;
        this.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: device.createShaderModule({ code: shaderCode }),
                entryPoint: 'vs_main'
            },
            fragment: {
                module: device.createShaderModule({ code: shaderCode }),
                entryPoint: 'fs_main',
                targets: [{ format: canvasFormat }]
            }
        });
    }
    
    render(context, bindGroup) {
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: [0, 0, 0, 1],
                storeOp: 'store'
            }]
        });
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(6, 1, 0, 0);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
