/* @ts-self-types="./minimemory.d.ts" */

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
    static __wrap(ptr) {
        const obj = Object.create(WasmOkfIndex.prototype);
        obj.__wbg_ptr = ptr;
        WasmOkfIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmOkfIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmokfindex_free(ptr, 0);
    }
    /**
     * Lista los Concept IDs únicos ingeridos como JSON array de strings.
     * @returns {string}
     */
    concepts() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmokfindex_concepts(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
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
     * @returns {string}
     */
    export_snapshot() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmokfindex_export_snapshot(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Importa un JSON snapshot (de [`export_snapshot`](Self::export_snapshot)),
     * reemplazando el contenido del índice. Devuelve la cantidad de documentos
     * importados. Ver [`export_snapshot`](Self::export_snapshot) para el
     * comportamiento del round-trip de conceptos e índice de metadata.
     * @param {string} json
     * @returns {number}
     */
    import_snapshot(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmokfindex_import_snapshot(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Ingerea un concepto desde string (portable). Reemplaza los chunks previos
     * del mismo `concept_id` (upsert idempotente). Devuelve la cantidad de
     * chunks insertados (`0` si se salta por falta de `type` o frontmatter roto).
     * @param {string} concept_id
     * @param {string} content
     * @returns {number}
     */
    ingest_concept(concept_id, content) {
        const ptr0 = passStringToWasm0(concept_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmokfindex_ingest_concept(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Verifica si el índice está vacío.
     * @returns {boolean}
     */
    is_empty() {
        const ret = wasm.wasmokfindex_is_empty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Número de documentos (chunks) en el índice.
     * @returns {number}
     */
    len() {
        const ret = wasm.wasmokfindex_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Crea un índice OKF en modo solo-BM25 con chunking por defecto.
     */
    constructor() {
        const ret = wasm.wasmokfindex_new();
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmOkfIndexFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Borra todos los chunks de un concepto. Devuelve la cantidad borrada.
     * @param {string} concept_id
     * @returns {number}
     */
    remove_concept(concept_id) {
        const ptr0 = passStringToWasm0(concept_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmokfindex_remove_concept(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Busca conceptos por keywords (BM25). Retorna un JSON array de hits:
     * `[{ concept_id, chunk_id, score, title?, snippet }, ...]`.
     *
     * `type_filter` restringe a un `type` OKF concreto (`null` = sin filtro).
     * @param {string} query
     * @param {number} k
     * @param {string | null} [type_filter]
     * @returns {string}
     */
    search(query, k, type_filter) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(type_filter) ? 0 : passStringToWasm0(type_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            const ret = wasm.wasmokfindex_search(this.__wbg_ptr, ptr0, len0, k, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Crea un índice OKF con chunking de tamaño fijo + overlap.
     *
     * # Arguments
     * * `target_size` - Tamaño objetivo de cada chunk (caracteres).
     * * `overlap` - Caracteres de overlap entre chunks consecutivos.
     * @param {number} target_size
     * @param {number} overlap
     * @returns {WasmOkfIndex}
     */
    static with_chunk_size(target_size, overlap) {
        const ret = wasm.wasmokfindex_with_chunk_size(target_size, overlap);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmOkfIndex.__wrap(ret[0]);
    }
}
if (Symbol.dispose) WasmOkfIndex.prototype[Symbol.dispose] = WasmOkfIndex.prototype.free;

/**
 * Base de datos vectorial para WebAssembly.
 * Permite almacenar y buscar vectores de alta dimensionalidad.
 */
export class WasmVectorDB {
    static __wrap(ptr) {
        const obj = Object.create(WasmVectorDB.prototype);
        obj.__wbg_ptr = ptr;
        WasmVectorDBFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmVectorDBFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmvectordb_free(ptr, 0);
    }
    /**
     * Limpia todos los vectores.
     */
    clear() {
        wasm.wasmvectordb_clear(this.__wbg_ptr);
    }
    /**
     * Verifica si un vector existe.
     * @param {string} id
     * @returns {boolean}
     */
    contains(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_contains(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
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
     * @param {string} field
     */
    create_metadata_index(field) {
        const ptr0 = passStringToWasm0(field, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_create_metadata_index(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Elimina un vector por su ID.
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_delete(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Dimensiones de los vectores.
     * @returns {number}
     */
    dimensions() {
        const ret = wasm.wasmvectordb_dimensions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Elimina el índice de metadata sobre `field`. Las consultas sobre ese
     * campo vuelven a resolverse por full-scan (mismos resultados, sólo más
     * lento). Los índices restantes se mantienen intactos.
     * @param {string} field
     */
    drop_metadata_index(field) {
        const ptr0 = passStringToWasm0(field, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_drop_metadata_index(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Export entire database as JSON snapshot for persistence.
     * Returns JSON string that can be saved to IndexedDB, localStorage, etc.
     * @returns {string}
     */
    export_snapshot() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmvectordb_export_snapshot(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Filter search: find documents matching metadata conditions.
     * filter_json: MongoDB-style filter, e.g. '{"category": "tech"}'
     * Returns JSON array of results.
     * @param {string} filter_json
     * @param {number} limit
     * @returns {string}
     */
    filter_search(filter_json, limit) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(filter_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmvectordb_filter_search(this.__wbg_ptr, ptr0, len0, limit);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Obtiene un vector por su ID.
     * Retorna null si no existe, o un JSON con vector y metadata.
     * @param {string} id
     * @returns {any}
     */
    get(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_get(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Obtiene todos los IDs como JSON array.
     * @returns {string}
     */
    ids() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmvectordb_ids(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Import database from a JSON snapshot (created by export_snapshot).
     * Clears existing data before importing.
     * @param {string} json
     * @returns {number}
     */
    import_snapshot(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_import_snapshot(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Inserta un vector en la base de datos.
     * @param {string} id
     * @param {Float32Array} vector
     */
    insert(id, vector) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_insert(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Inserta un vector truncandolo automaticamente a las dimensiones de la DB.
     * Ideal para embeddings Matryoshka (ej: Gemma 768d -> 256d).
     * @param {string} id
     * @param {Float32Array} full_vector
     */
    insert_auto(id, full_vector) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(full_vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_insert_auto(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Inserta con metadata, truncando automaticamente.
     * @param {string} id
     * @param {Float32Array} full_vector
     * @param {string} metadata_json
     */
    insert_auto_with_metadata(id, full_vector, metadata_json) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(full_vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(metadata_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_insert_auto_with_metadata(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Insert a document with optional vector. Works as a document store when vector is null.
     * metadata_json is required. vector is a Float32Array or null.
     * @param {string} id
     * @param {Float32Array | null | undefined} vector
     * @param {string} metadata_json
     */
    insert_document(id, vector, metadata_json) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(vector) ? 0 : passArrayF32ToWasm0(vector, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(metadata_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_insert_document(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Inserta un vector con metadata (como JSON string).
     * @param {string} id
     * @param {Float32Array} vector
     * @param {string} metadata_json
     */
    insert_with_metadata(id, vector, metadata_json) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(metadata_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_insert_with_metadata(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Verifica si esta vacia.
     * @returns {boolean}
     */
    is_empty() {
        const ret = wasm.wasmvectordb_is_empty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Busqueda por palabras clave (BM25).
     * Retorna JSON array con resultados.
     * @param {string} query
     * @param {number} k
     * @returns {string}
     */
    keyword_search(query, k) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmvectordb_keyword_search(this.__wbg_ptr, ptr0, len0, k);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Numero de vectores en la base de datos.
     * @returns {number}
     */
    len() {
        const ret = wasm.wasmvectordb_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * List documents with optional filter, ordering, and pagination.
     * Like SQL: SELECT * WHERE filter ORDER BY field LIMIT n OFFSET m
     * order_field: metadata field to sort by (empty string = no ordering)
     * order_desc: true for descending, false for ascending
     * @param {string} filter_json
     * @param {string} order_field
     * @param {boolean} order_desc
     * @param {number} limit
     * @param {number} offset
     * @returns {string}
     */
    list_documents(filter_json, order_field, order_desc, limit, offset) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(filter_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(order_field, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.wasmvectordb_list_documents(this.__wbg_ptr, ptr0, len0, ptr1, len1, order_desc, limit, offset);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Lista los campos con índice de metadata registrado, en orden
     * lexicográfico. Devuelve un JSON array de strings, p.ej. `["category","price"]`.
     * @returns {string}
     */
    list_metadata_indexes() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmvectordb_list_metadata_indexes(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Crea una nueva base de datos vectorial.
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones de los vectores
     * * `distance` - Metrica de distancia: "cosine", "euclidean", "dot"
     * * `index_type` - Tipo de indice: "flat", "hnsw"
     * @param {number} dimensions
     * @param {string} distance
     * @param {string} index_type
     */
    constructor(dimensions, distance, index_type) {
        const ptr0 = passStringToWasm0(distance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(index_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_new(dimensions, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmVectorDBFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Crea una base de datos con cuantizacion binaria (32x menos memoria).
     * Ideal para vectores de alta dimension (256+).
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones
     * * `distance` - "cosine", "euclidean", "dot"
     * * `index_type` - "flat" o "hnsw"
     * @param {number} dimensions
     * @param {string} distance
     * @param {string} index_type
     * @returns {WasmVectorDB}
     */
    static new_binary(dimensions, distance, index_type) {
        const ptr0 = passStringToWasm0(distance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(index_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_new_binary(dimensions, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmVectorDB.__wrap(ret[0]);
    }
    /**
     * Crea una base de datos con configuracion HNSW personalizada.
     * @param {number} dimensions
     * @param {string} distance
     * @param {number} m
     * @param {number} ef_construction
     * @returns {WasmVectorDB}
     */
    static new_hnsw(dimensions, distance, m, ef_construction) {
        const ptr0 = passStringToWasm0(distance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_new_hnsw(dimensions, ptr0, len0, m, ef_construction);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmVectorDB.__wrap(ret[0]);
    }
    /**
     * Crea una base de datos con cuantizacion 3-bit (~10.7x menos memoria).
     * Buen balance entre compresion y precision (~96-98% accuracy).
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones
     * * `distance` - "cosine", "euclidean", "dot"
     * * `index_type` - "flat" o "hnsw"
     * @param {number} dimensions
     * @param {string} distance
     * @param {string} index_type
     * @returns {WasmVectorDB}
     */
    static new_int3(dimensions, distance, index_type) {
        const ptr0 = passStringToWasm0(distance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(index_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_new_int3(dimensions, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmVectorDB.__wrap(ret[0]);
    }
    /**
     * Crea una base de datos con cuantizacion Int8 (4x menos memoria).
     *
     * # Arguments
     * * `dimensions` - Numero de dimensiones
     * * `distance` - "cosine", "euclidean", "dot"
     * * `index_type` - "flat" o "hnsw"
     * @param {number} dimensions
     * @param {string} distance
     * @param {string} index_type
     * @returns {WasmVectorDB}
     */
    static new_int8(dimensions, distance, index_type) {
        const ptr0 = passStringToWasm0(distance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(index_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_new_int8(dimensions, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmVectorDB.__wrap(ret[0]);
    }
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
     * @param {number} dimensions
     * @param {string} distance
     * @param {string} index_type
     * @param {string} quantization
     * @param {number | null} [hnsw_m]
     * @param {number | null} [hnsw_ef]
     * @returns {WasmVectorDB}
     */
    static new_with_config(dimensions, distance, index_type, quantization, hnsw_m, hnsw_ef) {
        const ptr0 = passStringToWasm0(distance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(index_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(quantization, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_new_with_config(dimensions, ptr0, len0, ptr1, len1, ptr2, len2, isLikeNone(hnsw_m) ? Number.MAX_SAFE_INTEGER : (hnsw_m) >>> 0, isLikeNone(hnsw_ef) ? Number.MAX_SAFE_INTEGER : (hnsw_ef) >>> 0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmVectorDB.__wrap(ret[0]);
    }
    /**
     * Busca los k vectores mas similares.
     * Retorna un JSON array con los resultados.
     * @param {Float32Array} query
     * @param {number} k
     * @returns {string}
     */
    search(query, k) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmvectordb_search(this.__wbg_ptr, ptr0, len0, k);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Busca truncando automaticamente el vector query.
     * @param {Float32Array} full_query
     * @param {number} k
     * @returns {string}
     */
    search_auto(full_query, k) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF32ToWasm0(full_query, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmvectordb_search_auto(this.__wbg_ptr, ptr0, len0, k);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Paginated vector search. Returns JSON with items + pagination metadata.
     * @param {Float32Array} query
     * @param {number} limit
     * @param {number} offset
     * @returns {string}
     */
    search_paged(query, limit, offset) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmvectordb_search_paged(this.__wbg_ptr, ptr0, len0, limit, offset);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Vector search with metadata filter.
     * Returns JSON array of results.
     * @param {Float32Array} query
     * @param {number} k
     * @param {string} filter_json
     * @returns {string}
     */
    search_with_filter(query, k, filter_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(filter_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.wasmvectordb_search_with_filter(this.__wbg_ptr, ptr0, len0, k, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Actualiza un vector existente.
     * @param {string} id
     * @param {Float32Array} vector
     */
    update(id, vector) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_update(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Actualiza truncando automaticamente.
     * @param {string} id
     * @param {Float32Array} full_vector
     */
    update_auto(id, full_vector) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(full_vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_update_auto(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Actualiza con metadata, truncando automaticamente.
     * @param {string} id
     * @param {Float32Array} full_vector
     * @param {string} metadata_json
     */
    update_auto_with_metadata(id, full_vector, metadata_json) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(full_vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(metadata_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_update_auto_with_metadata(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Actualiza un vector con metadata.
     * @param {string} id
     * @param {Float32Array} vector
     * @param {string} metadata_json
     */
    update_with_metadata(id, vector, metadata_json) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(vector, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(metadata_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvectordb_update_with_metadata(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) WasmVectorDB.prototype[Symbol.dispose] = WasmVectorDB.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_e6785c33c8e4cce8: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_3ed232c8a6baee09: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./minimemory_bg.js": import0,
    };
}

const WasmOkfIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmokfindex_free(ptr, 1));
const WasmVectorDBFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmvectordb_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('minimemory_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
