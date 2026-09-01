import { computeColumnProfileDataCpu } from "./backends/cpu/computeColumnProfileCpu.js";
import { computeCustomSchemeProfileData } from "../schemes/customColorScheme.js";

export class ColumnProfileService {
    constructor({
        device,
        schemes,
    }) {
        this.device = device;
        this.schemes = schemes;
    }

    async compute({
        alignmentState,
        schemeKey,
        columnMetrics = null,
        alphabet = null,
    }) {
        const activeScheme = this.schemes[schemeKey];
        let profileData = new Uint32Array(alignmentState.totalCols);
        if (activeScheme?.mode === "scalar-column") {
            profileData = computeCustomSchemeProfileData({
                scheme: activeScheme,
                totalCols: alignmentState.totalCols,
            });
        } else if (activeScheme.profileKind !== "none") {
            profileData = computeColumnProfileDataCpu({
                columnMetrics,
                alphabet,
                schemeKey,
                totalCols: alignmentState.totalCols,
            });
        }
        if (alignmentState.colProfileBuffer) {
            this.device.queue.writeBuffer(alignmentState.colProfileBuffer, 0, profileData);
            alignmentState.colProfileData = null;
        } else {
            alignmentState.colProfileData = profileData;
        }
    }
}
