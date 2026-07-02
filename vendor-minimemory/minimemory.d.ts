/* tslint:disable */
/* eslint-disable */

/**
 * Índice OKF (Open Knowledge Format) para WebAssembly.
 *
 * Ingiere conceptos OKF (markdown + frontmatter YAML con campo `type`) y los
 * busca por keywords (BM25) con filtro por `okf_type`.
 *
 * # Limitación v1
 *
 * Sólo modo BM25: sin vectores ni `embed_fn`. La búsqueda semántica/híbrida
 * requeriría un callback JS→Rust de embeddings, que queda fuera de esta v1.
 * En consecuencia todos los chunks se insertan sin vector.
 */
export class WasmOkfIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Lista los Concept IDs únicos ingeridos como JSON array de strings.
     */
    concepts(): string;
    /**
     * Exporta el índice como JSON snapshot (ids, vectores, metadata).
     *
     * # Round-trip del snapshot
     *
     * `OkfIndex` no mantiene un registro de conceptos separado: `concepts()`
     * se deriva de los documentos de la [`RustVectorDB`] subyacente (campo de
     * metadata `okf_concept`). El snapshot vuelca todos los documentos con su
     * metadata, así que `import_snapshot` **restaura los conceptos**: vuelven
     * a listarse y a ser buscables.
     *
     * El metadata index sobre `okf_type` (creado en `OkfIndex::new`) **no se
     * serializa** en el snapshot, pero: (a) en la MISMA instancia, el `clear`
     * interno preserva el registro del índice y las reinserciones lo repueblan,
     * así que el filtro por `okf_type` sigue funcionando tras importar; (b) en
     * una instancia RECIENTE construida con `new`/`with_chunk_size`, el
     * constructor recrea el índice sobre la DB vacía antes del import, y las
     * inserciones del import lo pueblan incrementalmente. En ambos casos el
     * round-trip restaura por completo conceptos, búsqueda y filtro.
     */
    export_snapshot(): string;
    /**
     * Importa un JSON snapshot (de [`export_snapshot`](Self::export_snapshot)),
     * reemplazando el contenido del índice. Devuelve la cantidad de documentos
     * importados. Ver [`export_snapshot`](Self::export_snapshot) para el
     * comportamiento del round-trip de conceptos e índice de metadata.
     */
    import_snapshot(json: string): number;
    /**
     * Ingerea un concepto desde string (portable). Reemplaza los chunks previos
     * del mismo `concept_id` (upsert idempotente). Devuelve la cantidad de
     * chunks insertados (`0` si se salta por falta de `type` o frontmatter roto).
     */
    ingest_concept(concept_id: string, content: string): number;
    /**
     * Verifica si el índice está vacío.
     */
    is_empty(): boolean;
    /**
     * Número de documentos (chunks) en el índice.
     */
    len(): number;
    /**
     * Crea un índice OKF en modo solo-BM25 con chunking por defecto.
     */
    constructor();
    /**
     * Borra todos los chunks de un concepto. Devuelve la cantidad borrada.
     */
    remove_concept(concept_id: string): number;
    /**
     * Busca conceptos por keywords (BM25). Retorna un JSON array de hits:
     * `[{ concept_id, chunk_id, score, title?, snippet }, ...]`.
     *
     * `type_filter` restringe a un `type` OKF concreto (`null` = sin filtro).
     */
    search(query: string, k: number, type_filter?: string | null): string;
    /**
     * Crea un índice OKF con chunking de tamaño fijo + overlap.
     *
     * # Arguments
     * * `target_size` - Tamaño objetivo de cada chunk (caracteres).
     * * `overlap` - Caracteres de overlap entre chunks consecutivos.
     */
    static with_chunk_size(target_size: number, overlap: number): WasmOkfIndex;
}

/**
 * Base de datos vectorial para WebAssembly.
 * Permite almacenar y buscar vectores de alta dimensionalidad.
 */
export class WasmVectorDB {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Limpia todos los vectores.
     */
    clear(): void;
    /**
     * Verifica si un vector existe.
     */
    contains(id: string): boolean;
    /**
     * Crea un índice de metadata opt-in sobre `field`. Es retroactivo: indexa
     * automáticamente los documentos ya presentes (no hay que reinsertar).
     *
     * Acelera los filtros `$eq` y de rango (`$gt`, `$gte`, `$lt`, `$lte`)
     * resueltos por `filter_search`, `list_documents` y `search_with_filter`
     * a través del query planner interno. Los resultados no cambian, sólo la
     * velocidad: el índice nunca altera qué documentos coinciden.
     *
     * # Persistencia
     *
     * Los índices **no** se serializan en `export_snapshot` (éste sólo vuelca
     * ids, vectores y metadata). `import_snapshot` sobre una `WasmVectorDB`
     * que ya tenga índices registrados **los conserva**: el `clear` interno
     * vacía los buckets pero mantiene los campos indexados, y las inserciones
     * del import los repueblan. En cambio, importar el snapshot en una
     * `WasmVectorDB` recién construida arranca sin índices y hay que
     * recrearlos con este método (que indexa retroactivamente lo importado).
     */
    create_metadata_index(field: string): void;
    /**
     * Elimina un vector por su ID.
     */
    delete(id: string): boolean;
    /**
     * Dimensiones de los vectores.
     */
    dimensions(): number;
    /**
     * Elimina el índice de metadata sobre `field`. Las consultas sobre ese
     * campo vuelven a resolverse por full-scan (mismos resultados, sólo más
     * lento). Los índices restantes se mantienen intactos.
     */
    drop_metadata_index(field: string): void;
    /**
     * Export entire database as JSON snapshot for persistence.
     * Returns JSON string that can be saved to IndexedDB, localStorage, etc.
     */
    export_snapshot(): string;
    /**
     * Filter search: find documents matching metadata conditions.
     * filter_json: MongoDB-style filter, e.g. '{"category": "tech"}'
     * Returns JSON array of results.
     */
    filter_search(filter_json: string, limit: number): string;
    /**
     * Obtiene un vector por su ID.
     * Retorna null si no existe, o un JSON con vector y metadata.
     */
    get(id: string): any;
    /**
     * Obtiene todos los IDs como JSON array.
     */
    ids(): string;
    /**
     * Import database from a JSON snapshot (created by export_snapshot).
     * Clears existing data before importing.
     */
    import_snapshot(json: string): number;
    /**
     * Inserta un vector en la base de datos.
     */
    insert(id: string, vector: Float32Array): void;
    /**
     * Inserta un vector truncandolo automaticamente a las dimensiones de la DB.
     * Ideal para embeddings Matryoshka (ej: Gemma 768d -> 256d).
     */
    insert_auto(id: string, full_vector: Float32Array): void;
    /**
     * Inserta con metadata, truncando automaticamente.
     */
    insert_auto_with_metadata(id: string, full_vector: Float32Array, metadata_json: string): void;
    /**
     * Insert a document with optional vector. Works as a document store when vector is null.
     * metadata_json is required. vector is a Float32Array or null.
     */
    insert_document(id: string, vector: Float32Array | null | undefined, metadata_json: string): void;
    /**
     * Inserta un vector con metadata (como JSON string).
     */
    insert_with_metadata(id: string, vector: Float32Array, metadata_json: string): void;
    /**
     * Verifica si esta vacia.
     */
    is_empty(): boolean;
    /**
     * Busqueda por palabras clave (BM25).
     * Retorna JSON array con resultados.
     */
    keyword_search(query: string, k: number): string;
    /**
     * Numero de vectores en la base de datos.
     */
    len(): number;
    /**
     * List documents with optional filter, ordering, and pagination.
     * Like SQL: SELECT * WHERE filter ORDER BY field LIMIT n OFFSET m
     * order_field: metadata field to sort by (empty string = no ordering)
     * order_desc: true for descending, false for ascending
     */
    list_documents(filter_json: string, order_field: string, order_desc: boolean, limit: number, offset: number): string;
    /**
     * Lista los campos con índice de metadata registrado, en orden
     * lexicográfico. Devuelve un JSON array de strings, p.ej. `["category","price"]`.
     */
    list_metadata_indexes(): string;
    /**
     * Crea una nueva base de datos vectorial.
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones de los vectores
     * * `distance` - Metrica de distancia: "cosine", "euclidean", "dot"
     * * `index_type` - Tipo de indice: "flat", "hnsw"
     */
    constructor(dimensions: number, distance: string, index_type: string);
    /**
     * Crea una base de datos con cuantizacion binaria (32x menos memoria).
     * Ideal para vectores de alta dimension (256+).
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones
     * * `distance` - "cosine", "euclidean", "dot"
     * * `index_type` - "flat" o "hnsw"
     */
    static new_binary(dimensions: number, distance: string, index_type: string): WasmVectorDB;
    /**
     * Crea una base de datos con configuracion HNSW personalizada.
     */
    static new_hnsw(dimensions: number, distance: string, m: number, ef_construction: number): WasmVectorDB;
    /**
     * Crea una base de datos con cuantizacion 3-bit (~10.7x menos memoria).
     * Buen balance entre compresion y precision (~96-98% accuracy).
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones
     * * `distance` - "cosine", "euclidean", "dot"
     * * `index_type` - "flat" o "hnsw"
     */
    static new_int3(dimensions: number, distance: string, index_type: string): WasmVectorDB;
    /**
     * Crea una base de datos con cuantizacion Int8 (4x menos memoria).
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones
     * * `distance` - "cosine", "euclidean", "dot"
     * * `index_type` - "flat" o "hnsw"
     */
    static new_int8(dimensions: number, distance: string, index_type: string): WasmVectorDB;
    /**
     * Crea una base de datos con configuracion completa.
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones
     * * `distance` - "cosine", "euclidean", "dot"
     * * `index_type` - "flat" o "hnsw"
     * * `quantization` - "none", "int8", "binary"
     * * `hnsw_m` - Parametro M para HNSW (default 16)
     * * `hnsw_ef` - ef_construction para HNSW (default 200)
     */
    static new_with_config(dimensions: number, distance: string, index_type: string, quantization: string, hnsw_m?: number | null, hnsw_ef?: number | null): WasmVectorDB;
    /**
     * Busca los k vectores mas similares.
     * Retorna un JSON array con los resultados.
     */
    search(query: Float32Array, k: number): string;
    /**
     * Busca truncando automaticamente el vector query.
     */
    search_auto(full_query: Float32Array, k: number): string;
    /**
     * Paginated vector search. Returns JSON with items + pagination metadata.
     */
    search_paged(query: Float32Array, limit: number, offset: number): string;
    /**
     * Vector search with metadata filter.
     * Returns JSON array of results.
     */
    search_with_filter(query: Float32Array, k: number, filter_json: string): string;
    /**
     * Actualiza un vector existente.
     */
    update(id: string, vector: Float32Array): void;
    /**
     * Actualiza truncando automaticamente.
     */
    update_auto(id: string, full_vector: Float32Array): void;
    /**
     * Actualiza con metadata, truncando automaticamente.
     */
    update_auto_with_metadata(id: string, full_vector: Float32Array, metadata_json: string): void;
    /**
     * Actualiza un vector con metadata.
     */
    update_with_metadata(id: string, vector: Float32Array, metadata_json: string): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmokfindex_free: (a: number, b: number) => void;
    readonly __wbg_wasmvectordb_free: (a: number, b: number) => void;
    readonly wasmokfindex_concepts: (a: number) => [number, number];
    readonly wasmokfindex_export_snapshot: (a: number) => [number, number, number, number];
    readonly wasmokfindex_import_snapshot: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmokfindex_ingest_concept: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmokfindex_is_empty: (a: number) => number;
    readonly wasmokfindex_len: (a: number) => number;
    readonly wasmokfindex_new: () => [number, number, number];
    readonly wasmokfindex_remove_concept: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmokfindex_search: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly wasmokfindex_with_chunk_size: (a: number, b: number) => [number, number, number];
    readonly wasmvectordb_clear: (a: number) => void;
    readonly wasmvectordb_contains: (a: number, b: number, c: number) => number;
    readonly wasmvectordb_create_metadata_index: (a: number, b: number, c: number) => [number, number];
    readonly wasmvectordb_delete: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmvectordb_dimensions: (a: number) => number;
    readonly wasmvectordb_drop_metadata_index: (a: number, b: number, c: number) => [number, number];
    readonly wasmvectordb_export_snapshot: (a: number) => [number, number, number, number];
    readonly wasmvectordb_filter_search: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasmvectordb_get: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmvectordb_ids: (a: number) => [number, number, number, number];
    readonly wasmvectordb_import_snapshot: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmvectordb_insert: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasmvectordb_insert_auto: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasmvectordb_insert_auto_with_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmvectordb_insert_document: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmvectordb_insert_with_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmvectordb_is_empty: (a: number) => number;
    readonly wasmvectordb_keyword_search: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasmvectordb_len: (a: number) => number;
    readonly wasmvectordb_list_documents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly wasmvectordb_list_metadata_indexes: (a: number) => [number, number];
    readonly wasmvectordb_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmvectordb_new_binary: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmvectordb_new_hnsw: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmvectordb_new_int3: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmvectordb_new_int8: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmvectordb_new_with_config: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly wasmvectordb_search: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasmvectordb_search_auto: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasmvectordb_search_paged: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly wasmvectordb_search_with_filter: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly wasmvectordb_update: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasmvectordb_update_auto: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasmvectordb_update_auto_with_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmvectordb_update_with_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
