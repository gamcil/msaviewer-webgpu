export type AlphabetId = string;
export type RepresentationId = string;
export type RenderingBackend = "auto" | "webgpu" | "cpu";
export type ResolvedBackend = "webgpu" | "cpu";
export type ThemeMode = "auto" | "dark" | "light";
export type SelectionMode = "cell" | "column" | "row";
export type TrackDisplayDefaults = "active-only" | "all-supported" | "none";
export type ColorValue = string | readonly number[];
export type ColormapValue = string | readonly ColorValue[];

export interface AlphabetDefinition {
  id: AlphabetId;
  label?: string;
  shortLabel?: string;
  symbols?: readonly string[];
  logoColors?: readonly string[];
  supports?: Record<string, unknown>;
  [key: string]: unknown;
}

export class AlphabetRegistry {
  register(alphabet: AlphabetDefinition): AlphabetDefinition;
  get(id: AlphabetId): AlphabetDefinition | null;
  has(id: AlphabetId): boolean;
  list(): AlphabetDefinition[];
}

export const aminoAcidAlphabet: AlphabetDefinition;
export const nucleotideAlphabet: AlphabetDefinition;
export const threeDIAlphabet: AlphabetDefinition;
export const defaultAlphabetRegistry: AlphabetRegistry;

export interface RegisteredColorScheme {
  key: string;
  label: string;
  min: number;
  max: number;
  missingValue: number | null;
  columnCount: number;
}

export interface RegisterCustomColorSchemeOptions {
  label?: string;
  values: ArrayLike<number>;
  min: number;
  max: number;
  colormap: ColormapValue;
  missingValue?: number | null;
}

export interface AlignmentRecord {
  name: string;
  [key: string]: unknown;
}

export interface AlignmentTile {
  key: string;
  rowTile: number;
  colTile: number;
  rowStart: number;
  rowCount: number;
  colStart: number;
  colCount: number;
  /** Present only when OPFS is unavailable. */
  blob?: Blob;
  /** Byte range in the viewer-managed OPFS alignment file. */
  byteOffset?: number;
  byteLength?: number;
}

export interface AlignmentStore {
  records: AlignmentRecord[];
  totalRows: number;
  totalCols: number;
  tileRows?: number;
  tileCols?: number;
  rowTileCount?: number;
  colTileCount?: number;
  tiles?: AlignmentTile[];
  [key: string]: unknown;
}

export interface DataInput {
  source?: string | Blob | { name?: string; stream?: () => ReadableStream<Uint8Array> };
  file?: Blob & { name?: string };
  store?: AlignmentStore;
  format?: "auto" | "fasta" | "a3m";
  id?: RepresentationId;
  label?: string;
  alphabetId?: AlphabetId;
}

export interface RepresentationSummary {
  id: RepresentationId;
  label: string;
  alphabetId: AlphabetId;
  alphabetLabel?: string;
  alphabetShortLabel?: string;
  displayLabel?: string;
  totalRows: number | null;
  totalCols: number | null;
}

export interface LoadDataResult {
  activeId: RepresentationId | null;
  active: RepresentationSummary | null;
  representations: RepresentationSummary[];
}

export interface SelectionRange {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

export interface SelectionSnapshot {
  mode: SelectionMode;
  ranges: SelectionRange[];
  componentCount: number;
}

export interface RowStyle {
  rowIndex: number;
  headerBackground?: string | null;
  headerColor?: string | null;
}

export interface ColumnVisibilitySnapshot {
  mode: string;
  visible: Uint8Array;
  rawToVisible: Int32Array;
  visibleToRaw: Uint32Array;
  visibleCount: number;
  totalCols: number;
  signature: string | number;
}

export interface RawColumnRange {
  /** Inclusive raw-alignment column index. */
  start: number;
  /** Exclusive raw-alignment column index. */
  end: number;
}

export interface ComputedAlphabet {
  id: AlphabetId;
  label: string;
  shortLabel: string;
  /** Non-gap symbols, ordered to match consensus indices and frequencies. */
  symbols: string[];
  gapSymbol: string;
}

export type ColumnMetricField =
  | "quality"
  | "occupancy"
  | "entropy"
  | "modalFractionNonGap"
  | "informationContentRaw"
  | "consensusIndex"
  | "consensusTie"
  | "conservationScore"
  | "conservationMask";

export interface ColumnMetricsOptions {
  representationId?: RepresentationId | null;
  rawColumnRange?: RawColumnRange | null;
  fields?: ColumnMetricField[] | null;
}

export interface ColumnMetricsSnapshot {
  representationId: RepresentationId;
  totalRows: number;
  totalCols: number;
  rawColumnRange: RawColumnRange;
  alphabet: ComputedAlphabet;
  quality?: Float32Array;
  occupancy?: Float32Array;
  entropy?: Float32Array;
  modalFractionNonGap?: Float32Array;
  informationContentRaw?: Float32Array;
  consensusIndex?: Uint16Array;
  consensusTie?: Uint8Array;
  conservationScore?: Uint8Array;
  conservationMask?: Uint32Array;
}

export interface ConsensusOptions {
  representationId?: RepresentationId | null;
  rawColumnRange?: RawColumnRange | null;
  includeFrequencies?: boolean;
}

export interface ConsensusResidue {
  symbol: string;
  count: number;
  fraction: number;
}

export interface ConsensusColumn {
  rawColumn: number;
  occupancy: number;
  modalFractionNonGap: number;
  informationContentRaw: number;
  nonGapCount: number;
  consensusGlyph: string | null;
  residues?: ConsensusResidue[];
}

export interface ConsensusSnapshot {
  representationId: RepresentationId;
  totalRows: number;
  totalCols: number;
  rawColumnRange: RawColumnRange;
  alphabet: ComputedAlphabet;
  columns: ConsensusColumn[];
}

export interface SchemeVariant {
  representationId: RepresentationId | null;
  alphabetId: AlphabetId | null;
  alphabetShortLabel?: string | null;
  displayLabel: string;
}

export interface SchemeOption {
  key: string;
  label: string;
  group: string;
  mode?: string;
  variants: SchemeVariant[];
}

export interface TrackRef {
  trackId: string;
  representation?: RepresentationId | "active";
}

export interface TrackVariant extends TrackRef {
  enabled?: boolean;
  label?: string | null;
}

export interface TrackOption {
  id: string;
  label: string;
  variants: TrackVariant[];
}

export interface TrackSource {
  type: "metric" | "values" | "consensus" | string;
  representation?: RepresentationId | "active";
  metric?: string;
  values?: unknown;
  [key: string]: unknown;
}

export interface TrackColorRamp {
  min?: number;
  max?: number;
  colormap?: ColormapValue | null;
  missingValue?: number | null;
  target?: "fill" | "stroke" | "glyph" | "points" | string;
  [key: string]: unknown;
}

export interface TrackLayer {
  type: "bar" | "line" | "glyph" | "logo" | string;
  source?: TrackSource;
  coloring?: Record<string, unknown>;
  height?: number;
  style?: Record<string, unknown>;
  colorRamp?: TrackColorRamp;
  colorRamps?: {
    fill?: TrackColorRamp;
    stroke?: TrackColorRamp;
    glyph?: TrackColorRamp;
    [key: string]: TrackColorRamp | undefined;
  };
  [key: string]: unknown;
}

export interface TrackDefinition {
  id: string;
  label?: string;
  source?: TrackSource;
  coloring?: Record<string, unknown>;
  supports?: {
    alphabets?: AlphabetId[] | null;
    shared?: boolean;
    [key: string]: unknown;
  };
  lanes: Array<{
    layers: TrackLayer[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface MSAViewerConfig {
  alphabet: AlphabetId | AlphabetDefinition;
  layout: {
    header: false | { visible?: boolean; width?: number };
    ruler: false | { visible?: boolean; height?: number; tickInterval?: number };
    minimap: false | { visible?: boolean; height?: number; fullWidth?: boolean };
    tracks: false | { visible?: boolean; labelWidth?: number };
    cell: { width?: number; height?: number };
  };
  theme: {
    mode: ThemeMode;
    typography: {
      uiFontFamily?: string;
      uiFontSize?: number;
      headerFontFamily?: string;
      headerFontSize?: number;
    };
  };
  tracks: TrackDefinition[];
  trackDisplay: {
    defaults: TrackDisplayDefaults;
    variants: Array<TrackRef & { enabled?: boolean }>;
    order: string[] | null;
  };
  behavior: {
    selectionMode: SelectionMode;
    masking: {
      hideInsertionColumns: boolean;
      gapThreshold: number | null;
    };
  };
  interactions: {
    onSequenceClick?: ((detail: SequenceClickDetail) => void) | null;
  };
  rendering: {
    backend: RenderingBackend;
    scheme: string;
    schemeSourceRepresentationId: RepresentationId | null;
  };
}

export interface MSAViewerConfigInput {
  alphabet?: AlphabetId | AlphabetDefinition;
  layout?: Partial<{
    header: false | Partial<Extract<MSAViewerConfig["layout"]["header"], object>>;
    ruler: false | Partial<Extract<MSAViewerConfig["layout"]["ruler"], object>>;
    minimap: false | Partial<Extract<MSAViewerConfig["layout"]["minimap"], object>>;
    tracks: false | Partial<Extract<MSAViewerConfig["layout"]["tracks"], object>>;
    cell: Partial<MSAViewerConfig["layout"]["cell"]>;
  }>;
  theme?: Partial<{
    mode: ThemeMode;
    typography: Partial<MSAViewerConfig["theme"]["typography"]>;
  }>;
  tracks?: TrackDefinition[];
  trackDisplay?: Partial<{
    defaults: TrackDisplayDefaults;
    variants: Array<TrackRef & { enabled?: boolean }>;
    order: string[] | null;
  }>;
  behavior?: Partial<{
    selectionMode: SelectionMode;
    masking: Partial<MSAViewerConfig["behavior"]["masking"]>;
  }>;
  interactions?: Partial<MSAViewerConfig["interactions"]>;
  rendering?: Partial<MSAViewerConfig["rendering"]>;
}

export interface MSAViewerRuntime {
  device?: unknown;
  format?: string | null;
  themeMedia?: MediaQueryList;
  alphabetRegistry?: AlphabetRegistry;
}

export interface MSAViewerOptions {
  root: HTMLElement;
  runtime?: MSAViewerRuntime;
  config?: MSAViewerConfigInput;
}

export interface SequenceClickDetail {
  rowIndex: number;
  record: AlignmentRecord;
  representationId: RepresentationId | null;
  alphabetId: AlphabetId | null;
  originalEvent: Event;
}

export interface CellHoverDetail {
  rowIndex: number | null;
  rawColumn: number | null;
  visibleColumn: number | null;
  record: AlignmentRecord | null;
  representationId: RepresentationId | null;
  alphabetId: AlphabetId | null;
  symbol?: string | null;
  sequenceResidueIndex: number | null;
  sequenceResidueNumber: number | null;
  originalEvent: MouseEvent | null;
}

export interface SelectionChangeDetail {
  selection: SelectionSnapshot;
}

export interface VisibilityChangeDetail {
  columnVisibility: ColumnVisibilitySnapshot | null;
  representationId: RepresentationId | null;
}

export interface ViewerErrorDetail {
  error: unknown;
}

export interface ZoomAnchor {
  clientX?: number;
  clientY?: number;
}

export interface ZoomChangeDetail {
  zoom: number;
  cellWidth: number;
  cellHeight: number;
}

export interface MSAViewerEventMap {
  sequenceclick: CustomEvent<SequenceClickDetail>;
  cellhover: CustomEvent<CellHoverDetail>;
  selectionchange: CustomEvent<SelectionChangeDetail>;
  visibilitychange: CustomEvent<VisibilityChangeDetail>;
  zoomchange: CustomEvent<ZoomChangeDetail>;
  error: CustomEvent<ViewerErrorDetail>;
}

export class MSAViewer {
  constructor(options: MSAViewerOptions);

  addEventListener<K extends keyof MSAViewerEventMap>(
    type: K,
    listener: (event: MSAViewerEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof MSAViewerEventMap>(
    type: K,
    listener: (event: MSAViewerEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;

  getConfig(): MSAViewerConfig;
  getZoom(): number;
  getBackend(): ResolvedBackend;
  getRepresentations(): RepresentationSummary[];
  getActiveRepresentation(): RepresentationSummary | null;
  getSchemes(): SchemeOption[];
  getTracks(): TrackOption[];
  getSelection(): SelectionSnapshot;
  getColumnVisibility(options?: { representationId?: RepresentationId | null }): ColumnVisibilitySnapshot | null;
  getColumnMetrics(options?: ColumnMetricsOptions): Promise<ColumnMetricsSnapshot | null>;
  getConsensus(options?: ConsensusOptions): Promise<ConsensusSnapshot | null>;
  registerColorScheme(key: string, options: RegisterCustomColorSchemeOptions): Promise<RegisteredColorScheme>;

  setConfig(config?: MSAViewerConfigInput): Promise<void>;
  setZoom(zoom: number, anchor?: ZoomAnchor): number;
  zoomIn(anchor?: ZoomAnchor): number;
  zoomOut(anchor?: ZoomAnchor): number;
  loadData(input: DataInput | DataInput[], options?: { activeId?: RepresentationId | null }): Promise<LoadDataResult>;
  setActiveRepresentation(id: RepresentationId): Promise<RepresentationSummary | null>;
  setTrackEnabled(track: TrackRef | TrackVariant | string, enabled: boolean): Promise<void>;
  setRowStyles(rowStyles?: RowStyle[]): void;
  clearRowStyles(): void;
  setSelection(selection?: { mode?: SelectionMode; ranges?: SelectionRange[] }): void;
  clearSelection(): void;
  exportSelectionAsFasta(options?: { representationId?: RepresentationId | null; lineWidth?: number }): Promise<string>;
  setMotifQuery(query: string): Promise<number>;
  destroy(): void;
}
