export type AlphabetId = string;
export type RepresentationId = string;
export type RenderingBackend = "auto" | "webgpu" | "cpu";
export type ResolvedBackend = "webgpu" | "cpu";
export type ThemeMode = "auto" | "dark" | "light";
export type SelectionMode = "cell" | "column" | "row";
export type TrackDisplayDefaults = "active-only" | "all-supported" | "none";

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
  blob: Blob;
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
  type?: string;
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

export interface TrackLayer {
  type: "bar" | "line" | "glyph" | "logo" | string;
  source?: TrackSource;
  coloring?: Record<string, unknown>;
  height?: number;
  style?: Record<string, unknown>;
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

export interface SelectionChangeDetail {
  selection: SelectionSnapshot;
}

export interface ViewerErrorDetail {
  error: unknown;
}

export interface MSAViewerEventMap {
  sequenceclick: CustomEvent<SequenceClickDetail>;
  selectionchange: CustomEvent<SelectionChangeDetail>;
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
  getBackend(): ResolvedBackend;
  getRepresentations(): RepresentationSummary[];
  getActiveRepresentation(): RepresentationSummary | null;
  getSchemes(): SchemeOption[];
  getTracks(): TrackOption[];
  getSelection(): SelectionSnapshot;

  setConfig(config?: MSAViewerConfigInput): Promise<void>;
  loadData(input: DataInput | DataInput[], options?: { activeId?: RepresentationId | null }): Promise<LoadDataResult>;
  setActiveRepresentation(id: RepresentationId): Promise<RepresentationSummary | null>;
  setTrackEnabled(track: TrackRef | TrackVariant | string, enabled: boolean): Promise<void>;
  setSelection(selection?: { mode?: SelectionMode; ranges?: SelectionRange[] }): void;
  clearSelection(): void;
  exportSelectionAsFasta(options?: { representationId?: RepresentationId | null; lineWidth?: number }): Promise<string>;
  setMotifQuery(query: string): Promise<number>;
  destroy(): void;
}
