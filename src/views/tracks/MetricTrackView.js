import { BaseTrackView } from "./BaseTrackView.js";

export class MetricTrackView extends BaseTrackView {
    constructor({ metric = null, ...options }) {
        super(options);
        this.metric = metric ?? this.id;
    }

    setTrackState(trackState) {
        super.setTrackState(trackState);
        this.setData(this.getMetricData(trackState));
    }

    getMetricData(trackState = this.trackState) {
        return trackState?.metrics?.[this.metric] ?? null;
    }

    setValueRange(valueRange) {
        this.valueRange = valueRange ? {
            min: valueRange.min ?? 0,
            max: valueRange.max ?? 1,
        } : null;
    }
}
