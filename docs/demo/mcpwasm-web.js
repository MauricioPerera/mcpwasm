var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@jitl/quickjs-ffi-types/dist/index.mjs
function assertSync(fn) {
  return function(...args) {
    let result = fn(...args);
    if (result && typeof result == "object" && result instanceof Promise) throw new Error("Function unexpectedly returned a Promise");
    return result;
  };
}
var EvalFlags, IntrinsicsFlags, JSPromiseStateEnum, GetOwnPropertyNamesFlags, IsEqualOp;
var init_dist = __esm({
  "node_modules/@jitl/quickjs-ffi-types/dist/index.mjs"() {
    EvalFlags = { JS_EVAL_TYPE_GLOBAL: 0, JS_EVAL_TYPE_MODULE: 1, JS_EVAL_TYPE_DIRECT: 2, JS_EVAL_TYPE_INDIRECT: 3, JS_EVAL_TYPE_MASK: 3, JS_EVAL_FLAG_STRICT: 8, JS_EVAL_FLAG_STRIP: 16, JS_EVAL_FLAG_COMPILE_ONLY: 32, JS_EVAL_FLAG_BACKTRACE_BARRIER: 64 };
    IntrinsicsFlags = { BaseObjects: 1, Date: 2, Eval: 4, StringNormalize: 8, RegExp: 16, RegExpCompiler: 32, JSON: 64, Proxy: 128, MapSet: 256, TypedArrays: 512, Promise: 1024, BigInt: 2048, BigFloat: 4096, BigDecimal: 8192, OperatorOverloading: 16384, BignumExt: 32768 };
    JSPromiseStateEnum = { Pending: 0, Fulfilled: 1, Rejected: 2 };
    GetOwnPropertyNamesFlags = { JS_GPN_STRING_MASK: 1, JS_GPN_SYMBOL_MASK: 2, JS_GPN_PRIVATE_MASK: 4, JS_GPN_ENUM_ONLY: 16, JS_GPN_SET_ENUM: 32, QTS_GPN_NUMBER_MASK: 64, QTS_STANDARD_COMPLIANT_NUMBER: 128 };
    IsEqualOp = { IsStrictlyEqual: 0, IsSameValue: 1, IsSameValueZero: 2 };
  }
});

// node_modules/quickjs-emscripten-core/dist/chunk-V2S4ZYJR.mjs
function debugLog(...args) {
  QTS_DEBUG && console.log("quickjs-emscripten:", ...args);
}
function* awaitYield(value) {
  return yield value;
}
function awaitYieldOf(generator) {
  return awaitYield(awaitEachYieldedPromise(generator));
}
function maybeAsyncFn(that, fn) {
  return (...args) => {
    let generator = fn.call(that, AwaitYield, ...args);
    return awaitEachYieldedPromise(generator);
  };
}
function maybeAsync(that, startGenerator) {
  let generator = startGenerator.call(that, AwaitYield);
  return awaitEachYieldedPromise(generator);
}
function awaitEachYieldedPromise(gen) {
  function handleNextStep(step) {
    return step.done ? step.value : step.value instanceof Promise ? step.value.then((value) => handleNextStep(gen.next(value)), (error) => handleNextStep(gen.throw(error))) : handleNextStep(gen.next(step.value));
  }
  return handleNextStep(gen.next());
}
function scopeFinally(scope, blockError) {
  let disposeError;
  try {
    scope.dispose();
  } catch (error) {
    disposeError = error;
  }
  if (blockError && disposeError) throw Object.assign(blockError, { message: `${blockError.message}
 Then, failed to dispose scope: ${disposeError.message}`, disposeError }), blockError;
  if (blockError || disposeError) throw blockError || disposeError;
}
function createDisposableArray(items) {
  let array = items ? Array.from(items) : [];
  function disposeAlive() {
    return array.forEach((disposable) => disposable.alive ? disposable.dispose() : void 0);
  }
  function someIsAlive() {
    return array.some((disposable) => disposable.alive);
  }
  return Object.defineProperty(array, SymbolDispose, { configurable: true, enumerable: false, value: disposeAlive }), Object.defineProperty(array, "dispose", { configurable: true, enumerable: false, value: disposeAlive }), Object.defineProperty(array, "alive", { configurable: true, enumerable: false, get: someIsAlive }), array;
}
function isDisposable(value) {
  return !!(value && (typeof value == "object" || typeof value == "function") && "alive" in value && typeof value.alive == "boolean" && "dispose" in value && typeof value.dispose == "function");
}
function intrinsicsToFlags(intrinsics) {
  if (!intrinsics) return 0;
  let result = 0;
  for (let [maybeIntrinsicName, enabled] of Object.entries(intrinsics)) {
    if (!(maybeIntrinsicName in IntrinsicsFlags)) throw new QuickJSUnknownIntrinsic(maybeIntrinsicName);
    enabled && (result |= IntrinsicsFlags[maybeIntrinsicName]);
  }
  return result;
}
function evalOptionsToFlags(evalOptions) {
  if (typeof evalOptions == "number") return evalOptions;
  if (evalOptions === void 0) return 0;
  let { type, strict, strip, compileOnly, backtraceBarrier } = evalOptions, flags = 0;
  return type === "global" && (flags |= EvalFlags.JS_EVAL_TYPE_GLOBAL), type === "module" && (flags |= EvalFlags.JS_EVAL_TYPE_MODULE), strict && (flags |= EvalFlags.JS_EVAL_FLAG_STRICT), strip && (flags |= EvalFlags.JS_EVAL_FLAG_STRIP), compileOnly && (flags |= EvalFlags.JS_EVAL_FLAG_COMPILE_ONLY), backtraceBarrier && (flags |= EvalFlags.JS_EVAL_FLAG_BACKTRACE_BARRIER), flags;
}
function getOwnPropertyNamesOptionsToFlags(options) {
  if (typeof options == "number") return options;
  if (options === void 0) return 0;
  let { strings: includeStrings, symbols: includeSymbols, quickjsPrivate: includePrivate, onlyEnumerable, numbers: includeNumbers, numbersAsStrings } = options, flags = 0;
  return includeStrings && (flags |= GetOwnPropertyNamesFlags.JS_GPN_STRING_MASK), includeSymbols && (flags |= GetOwnPropertyNamesFlags.JS_GPN_SYMBOL_MASK), includePrivate && (flags |= GetOwnPropertyNamesFlags.JS_GPN_PRIVATE_MASK), onlyEnumerable && (flags |= GetOwnPropertyNamesFlags.JS_GPN_ENUM_ONLY), includeNumbers && (flags |= GetOwnPropertyNamesFlags.QTS_GPN_NUMBER_MASK), numbersAsStrings && (flags |= GetOwnPropertyNamesFlags.QTS_STANDARD_COMPLIANT_NUMBER), flags;
}
function concat(...values) {
  let result = [];
  for (let value of values) value !== void 0 && (result = result.concat(value));
  return result;
}
function getGroupId(id) {
  return id >> 8;
}
function applyBaseRuntimeOptions(runtime, options) {
  options.interruptHandler && runtime.setInterruptHandler(options.interruptHandler), options.maxStackSizeBytes !== void 0 && runtime.setMaxStackSize(options.maxStackSizeBytes), options.memoryLimitBytes !== void 0 && runtime.setMemoryLimit(options.memoryLimitBytes);
}
function applyModuleEvalRuntimeOptions(runtime, options) {
  options.moduleLoader && runtime.setModuleLoader(options.moduleLoader), options.shouldInterrupt && runtime.setInterruptHandler(options.shouldInterrupt), options.memoryLimitBytes !== void 0 && runtime.setMemoryLimit(options.memoryLimitBytes), options.maxStackSizeBytes !== void 0 && runtime.setMaxStackSize(options.maxStackSizeBytes);
}
var __defProp2, __export2, QTS_DEBUG, errors_exports, QuickJSUnwrapError, QuickJSWrongOwner, QuickJSUseAfterFree, QuickJSNotImplemented, QuickJSAsyncifyError, QuickJSAsyncifySuspended, QuickJSMemoryLeakDetected, QuickJSEmscriptenModuleError, QuickJSUnknownIntrinsic, QuickJSPromisePending, QuickJSEmptyGetOwnPropertyNames, QuickJSHostRefRangeExceeded, QuickJSHostRefInvalid, AwaitYield, UsingDisposable, SymbolDispose, prototypeAsAny, Lifetime, StaticLifetime, WeakLifetime, Scope, AbstractDisposableResult, DisposableSuccess, DisposableFail, DisposableResult, QuickJSDeferredPromise, ModuleMemory, UnstableSymbol, DefaultIntrinsics, QuickJSIterator, INT32_MIN, INT32_MAX, INVALID_HOST_REF_ID, HostRefMap, HostRef, ContextMemory, QuickJSContext, QuickJSRuntime, QuickJSEmscriptenModuleCallbacks, QuickJSModuleCallbacks, QuickJSWASMModule;
var init_chunk_V2S4ZYJR = __esm({
  "node_modules/quickjs-emscripten-core/dist/chunk-V2S4ZYJR.mjs"() {
    init_dist();
    init_dist();
    __defProp2 = Object.defineProperty;
    __export2 = (target, all) => {
      for (var name in all) __defProp2(target, name, { get: all[name], enumerable: true });
    };
    QTS_DEBUG = false;
    errors_exports = {};
    __export2(errors_exports, { QuickJSAsyncifyError: () => QuickJSAsyncifyError, QuickJSAsyncifySuspended: () => QuickJSAsyncifySuspended, QuickJSEmptyGetOwnPropertyNames: () => QuickJSEmptyGetOwnPropertyNames, QuickJSEmscriptenModuleError: () => QuickJSEmscriptenModuleError, QuickJSHostRefInvalid: () => QuickJSHostRefInvalid, QuickJSHostRefRangeExceeded: () => QuickJSHostRefRangeExceeded, QuickJSMemoryLeakDetected: () => QuickJSMemoryLeakDetected, QuickJSNotImplemented: () => QuickJSNotImplemented, QuickJSPromisePending: () => QuickJSPromisePending, QuickJSUnknownIntrinsic: () => QuickJSUnknownIntrinsic, QuickJSUnwrapError: () => QuickJSUnwrapError, QuickJSUseAfterFree: () => QuickJSUseAfterFree, QuickJSWrongOwner: () => QuickJSWrongOwner });
    QuickJSUnwrapError = class extends Error {
      constructor(cause, context) {
        let message = typeof cause == "object" && cause && "message" in cause ? String(cause.message) : String(cause);
        super(message);
        this.cause = cause;
        this.context = context;
        this.name = "QuickJSUnwrapError";
      }
    };
    QuickJSWrongOwner = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSWrongOwner";
      }
    };
    QuickJSUseAfterFree = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSUseAfterFree";
      }
    };
    QuickJSNotImplemented = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSNotImplemented";
      }
    };
    QuickJSAsyncifyError = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSAsyncifyError";
      }
    };
    QuickJSAsyncifySuspended = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSAsyncifySuspended";
      }
    };
    QuickJSMemoryLeakDetected = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSMemoryLeakDetected";
      }
    };
    QuickJSEmscriptenModuleError = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSEmscriptenModuleError";
      }
    };
    QuickJSUnknownIntrinsic = class extends TypeError {
      constructor() {
        super(...arguments);
        this.name = "QuickJSUnknownIntrinsic";
      }
    };
    QuickJSPromisePending = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSPromisePending";
      }
    };
    QuickJSEmptyGetOwnPropertyNames = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSEmptyGetOwnPropertyNames";
      }
    };
    QuickJSHostRefRangeExceeded = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSHostRefRangeExceeded";
      }
    };
    QuickJSHostRefInvalid = class extends Error {
      constructor() {
        super(...arguments);
        this.name = "QuickJSHostRefInvalid";
      }
    };
    AwaitYield = awaitYield;
    AwaitYield.of = awaitYieldOf;
    UsingDisposable = class {
      [Symbol.dispose]() {
        return this.dispose();
      }
    };
    SymbolDispose = Symbol.dispose ?? Symbol.for("Symbol.dispose");
    prototypeAsAny = UsingDisposable.prototype;
    prototypeAsAny[SymbolDispose] || (prototypeAsAny[SymbolDispose] = function() {
      return this.dispose();
    });
    Lifetime = class _Lifetime extends UsingDisposable {
      constructor(_value, copier, disposer, _owner) {
        super();
        this._value = _value;
        this.copier = copier;
        this.disposer = disposer;
        this._owner = _owner;
        this._alive = true;
        this._constructorStack = QTS_DEBUG ? new Error("Lifetime constructed").stack : void 0;
      }
      get alive() {
        return this._alive;
      }
      get value() {
        return this.assertAlive(), this._value;
      }
      get owner() {
        return this._owner;
      }
      get dupable() {
        return !!this.copier;
      }
      dup() {
        if (this.assertAlive(), !this.copier) throw new Error("Non-dupable lifetime");
        return new _Lifetime(this.copier(this._value), this.copier, this.disposer, this._owner);
      }
      consume(map) {
        this.assertAlive();
        let result = map(this);
        return this.dispose(), result;
      }
      map(map) {
        return this.assertAlive(), map(this);
      }
      tap(fn) {
        return fn(this), this;
      }
      dispose() {
        this.assertAlive(), this.disposer && this.disposer(this._value), this._alive = false;
      }
      assertAlive() {
        if (!this.alive) throw this._constructorStack ? new QuickJSUseAfterFree(`Lifetime not alive
${this._constructorStack}
Lifetime used`) : new QuickJSUseAfterFree("Lifetime not alive");
      }
    };
    StaticLifetime = class extends Lifetime {
      constructor(value, owner) {
        super(value, void 0, void 0, owner);
      }
      get dupable() {
        return true;
      }
      dup() {
        return this;
      }
      dispose() {
      }
    };
    WeakLifetime = class extends Lifetime {
      constructor(value, copier, disposer, owner) {
        super(value, copier, disposer, owner);
      }
      dispose() {
        this._alive = false;
      }
    };
    Scope = class _Scope extends UsingDisposable {
      constructor() {
        super(...arguments);
        this._disposables = new Lifetime(/* @__PURE__ */ new Set());
        this.manage = (lifetime) => (this._disposables.value.add(lifetime), lifetime);
      }
      static withScope(block) {
        let scope = new _Scope(), blockError;
        try {
          return block(scope);
        } catch (error) {
          throw blockError = error, error;
        } finally {
          scopeFinally(scope, blockError);
        }
      }
      static withScopeMaybeAsync(_this, block) {
        return maybeAsync(void 0, function* (awaited) {
          let scope = new _Scope(), blockError;
          try {
            return yield* awaited.of(block.call(_this, awaited, scope));
          } catch (error) {
            throw blockError = error, error;
          } finally {
            scopeFinally(scope, blockError);
          }
        });
      }
      static async withScopeAsync(block) {
        let scope = new _Scope(), blockError;
        try {
          return await block(scope);
        } catch (error) {
          throw blockError = error, error;
        } finally {
          scopeFinally(scope, blockError);
        }
      }
      get alive() {
        return this._disposables.alive;
      }
      dispose() {
        let lifetimes = Array.from(this._disposables.value.values()).reverse();
        for (let lifetime of lifetimes) lifetime.alive && lifetime.dispose();
        this._disposables.dispose();
      }
    };
    AbstractDisposableResult = class _AbstractDisposableResult extends UsingDisposable {
      static success(value) {
        return new DisposableSuccess(value);
      }
      static fail(error, onUnwrap) {
        return new DisposableFail(error, onUnwrap);
      }
      static is(result) {
        return result instanceof _AbstractDisposableResult;
      }
    };
    DisposableSuccess = class extends AbstractDisposableResult {
      constructor(value) {
        super();
        this.value = value;
      }
      get alive() {
        return isDisposable(this.value) ? this.value.alive : true;
      }
      dispose() {
        isDisposable(this.value) && this.value.dispose();
      }
      unwrap() {
        return this.value;
      }
      unwrapOr(_fallback) {
        return this.value;
      }
    };
    DisposableFail = class extends AbstractDisposableResult {
      constructor(error, onUnwrap) {
        super();
        this.error = error;
        this.onUnwrap = onUnwrap;
      }
      get alive() {
        return isDisposable(this.error) ? this.error.alive : true;
      }
      dispose() {
        isDisposable(this.error) && this.error.dispose();
      }
      unwrap() {
        throw this.onUnwrap(this), this.error;
      }
      unwrapOr(fallback) {
        return fallback;
      }
    };
    DisposableResult = AbstractDisposableResult;
    QuickJSDeferredPromise = class extends UsingDisposable {
      constructor(args) {
        super();
        this.resolve = (value) => {
          this.resolveHandle.alive && (this.context.unwrapResult(this.context.callFunction(this.resolveHandle, this.context.undefined, value || this.context.undefined)).dispose(), this.disposeResolvers(), this.onSettled());
        };
        this.reject = (value) => {
          this.rejectHandle.alive && (this.context.unwrapResult(this.context.callFunction(this.rejectHandle, this.context.undefined, value || this.context.undefined)).dispose(), this.disposeResolvers(), this.onSettled());
        };
        this.dispose = () => {
          this.handle.alive && this.handle.dispose(), this.disposeResolvers();
        };
        this.context = args.context, this.owner = args.context.runtime, this.handle = args.promiseHandle, this.settled = new Promise((resolve) => {
          this.onSettled = resolve;
        }), this.resolveHandle = args.resolveHandle, this.rejectHandle = args.rejectHandle;
      }
      get alive() {
        return this.handle.alive || this.resolveHandle.alive || this.rejectHandle.alive;
      }
      disposeResolvers() {
        this.resolveHandle.alive && this.resolveHandle.dispose(), this.rejectHandle.alive && this.rejectHandle.dispose();
      }
    };
    ModuleMemory = class {
      constructor(module2) {
        this.module = module2;
      }
      toPointerArray(handleArray) {
        let typedArray = new Int32Array(handleArray.map((handle) => handle.value)), numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT, ptr = this.module._malloc(numBytes);
        return new Uint8Array(this.module.HEAPU8.buffer, ptr, numBytes).set(new Uint8Array(typedArray.buffer)), new Lifetime(ptr, void 0, (ptr2) => this.module._free(ptr2));
      }
      newTypedArray(kind, length) {
        let zeros = new kind(new Array(length).fill(0)), numBytes = zeros.length * zeros.BYTES_PER_ELEMENT, ptr = this.module._malloc(numBytes), typedArray = new kind(this.module.HEAPU8.buffer, ptr, length);
        return typedArray.set(zeros), new Lifetime({ typedArray, ptr }, void 0, (value) => this.module._free(value.ptr));
      }
      newMutablePointerArray(length) {
        return this.newTypedArray(Int32Array, length);
      }
      newHeapCharPointer(string) {
        let strlen = this.module.lengthBytesUTF8(string), dataBytes = strlen + 1, ptr = this.module._malloc(dataBytes);
        return this.module.stringToUTF8(string, ptr, dataBytes), new Lifetime({ ptr, strlen }, void 0, (value) => this.module._free(value.ptr));
      }
      newHeapBufferPointer(buffer) {
        let numBytes = buffer.byteLength, ptr = this.module._malloc(numBytes);
        return this.module.HEAPU8.set(buffer, ptr), new Lifetime({ pointer: ptr, numBytes }, void 0, (value) => this.module._free(value.pointer));
      }
      consumeHeapCharPointer(ptr) {
        let str = this.module.UTF8ToString(ptr);
        return this.module._free(ptr), str;
      }
    };
    UnstableSymbol = Symbol("Unstable");
    DefaultIntrinsics = Object.freeze({ BaseObjects: true, Date: true, Eval: true, StringNormalize: true, RegExp: true, JSON: true, Proxy: true, MapSet: true, TypedArrays: true, Promise: true });
    QuickJSIterator = class extends UsingDisposable {
      constructor(handle, context) {
        super();
        this.handle = handle;
        this.context = context;
        this._isDone = false;
        this.owner = context.runtime;
      }
      [Symbol.iterator]() {
        return this;
      }
      next(value) {
        if (!this.alive || this._isDone) return { done: true, value: void 0 };
        let nextMethod = this._next ?? (this._next = this.context.getProp(this.handle, "next"));
        return this.callIteratorMethod(nextMethod, value);
      }
      return(value) {
        if (!this.alive) return { done: true, value: void 0 };
        let returnMethod = this.context.getProp(this.handle, "return");
        if (returnMethod === this.context.undefined && value === void 0) return this.dispose(), { done: true, value: void 0 };
        let result = this.callIteratorMethod(returnMethod, value);
        return returnMethod.dispose(), this.dispose(), result;
      }
      throw(e) {
        if (!this.alive) return { done: true, value: void 0 };
        let errorHandle = e instanceof Lifetime ? e : this.context.newError(e), throwMethod = this.context.getProp(this.handle, "throw"), result = this.callIteratorMethod(throwMethod, e);
        return errorHandle.alive && errorHandle.dispose(), throwMethod.dispose(), this.dispose(), result;
      }
      get alive() {
        return this.handle.alive;
      }
      dispose() {
        this._isDone = true, this.handle.dispose(), this._next?.dispose();
      }
      callIteratorMethod(method, input) {
        let callResult = input ? this.context.callFunction(method, this.handle, input) : this.context.callFunction(method, this.handle);
        if (callResult.error) return this.dispose(), { value: callResult };
        let done = this.context.getProp(callResult.value, "done").consume((v) => this.context.dump(v)), value = this.context.getProp(callResult.value, "value");
        return callResult.value.dispose(), done && this.dispose(), { value: DisposableResult.success(value), done };
      }
    };
    INT32_MIN = -2147483648;
    INT32_MAX = 2147483647;
    INVALID_HOST_REF_ID = 0;
    HostRefMap = class {
      constructor() {
        this.nextId = INT32_MIN;
        this.freelist = [];
        this.groups = /* @__PURE__ */ new Map();
      }
      put(value) {
        let id = this.allocateId(), groupId = getGroupId(id), group = this.groups.get(groupId);
        return group || (group = /* @__PURE__ */ new Map(), this.groups.set(groupId, group)), group.set(id, value), id;
      }
      get(id) {
        if (id === INVALID_HOST_REF_ID) throw new QuickJSHostRefInvalid("no host reference id defined");
        let groupId = getGroupId(id), group = this.groups.get(groupId);
        if (!group) throw new QuickJSHostRefInvalid(`host reference id ${id} is not defined`);
        let value = group.get(id);
        if (!value) throw new QuickJSHostRefInvalid(`host reference id ${id} is not defined`);
        return value;
      }
      delete(id) {
        if (id === INVALID_HOST_REF_ID) throw new QuickJSHostRefInvalid("no host reference id defined");
        let groupId = getGroupId(id), group = this.groups.get(groupId);
        if (!group) throw new QuickJSHostRefInvalid(`host reference id ${id} is not defined`);
        group.delete(id), group.size === 0 && this.groups.delete(groupId), this.freelist.push(id);
      }
      allocateId() {
        if (this.freelist.length > 0) return this.freelist.shift();
        if (this.nextId === INVALID_HOST_REF_ID && this.nextId++, this.nextId > INT32_MAX) throw new QuickJSHostRefRangeExceeded(`HostRefMap: too many host refs created without disposing. Max simultaneous host refs: ${INT32_MAX - INT32_MIN}`);
        return this.nextId++;
      }
    };
    HostRef = class extends UsingDisposable {
      constructor(runtime, handle, id) {
        if (id === INVALID_HOST_REF_ID) throw new QuickJSHostRefInvalid("cannot create HostRef with undefined id");
        super();
        this.runtime = runtime;
        this.handle = handle;
        this.id = id;
      }
      get alive() {
        return this.handle.alive;
      }
      dispose() {
        this.handle.dispose();
      }
      get value() {
        return this.runtime.hostRefs.get(this.id);
      }
    };
    ContextMemory = class extends ModuleMemory {
      constructor(args) {
        super(args.module);
        this.scope = new Scope();
        this.copyJSValue = (ptr) => this.ffi.QTS_DupValuePointer(this.ctx.value, ptr);
        this.freeJSValue = (ptr) => {
          this.ffi.QTS_FreeValuePointer(this.ctx.value, ptr);
        };
        args.ownedLifetimes?.forEach((lifetime) => this.scope.manage(lifetime)), this.owner = args.owner, this.module = args.module, this.ffi = args.ffi, this.rt = args.rt, this.ctx = this.scope.manage(args.ctx);
      }
      get alive() {
        return this.scope.alive;
      }
      dispose() {
        return this.scope.dispose();
      }
      [Symbol.dispose]() {
        return this.dispose();
      }
      manage(lifetime) {
        return this.scope.manage(lifetime);
      }
      consumeJSCharPointer(ptr) {
        let str = this.module.UTF8ToString(ptr);
        return this.ffi.QTS_FreeCString(this.ctx.value, ptr), str;
      }
      heapValueHandle(ptr, extraDispose) {
        let dispose = extraDispose ? (val) => {
          extraDispose(), this.freeJSValue(val);
        } : this.freeJSValue;
        return new Lifetime(ptr, this.copyJSValue, dispose, this.owner);
      }
      staticHeapValueHandle(ptr) {
        return this.manage(this.heapValueHandle(ptr)), new StaticLifetime(ptr, this.owner);
      }
    };
    QuickJSContext = class extends UsingDisposable {
      constructor(args) {
        super();
        this._undefined = void 0;
        this._null = void 0;
        this._false = void 0;
        this._true = void 0;
        this._global = void 0;
        this._BigInt = void 0;
        this._Symbol = void 0;
        this._SymbolIterator = void 0;
        this._SymbolAsyncIterator = void 0;
        this.cToHostCallbacks = { callFunction: (ctx, this_ptr, argc, argv, fn_id) => {
          if (ctx !== this.ctx.value) throw new Error("QuickJSContext instance received C -> JS call with mismatched ctx");
          let fn = this.getFunction(fn_id);
          return Scope.withScopeMaybeAsync(this, function* (awaited, scope) {
            let thisHandle = scope.manage(new WeakLifetime(this_ptr, this.memory.copyJSValue, this.memory.freeJSValue, this.runtime)), argHandles = new Array(argc);
            for (let i = 0; i < argc; i++) {
              let ptr = this.ffi.QTS_ArgvGetJSValueConstPointer(argv, i);
              argHandles[i] = scope.manage(new WeakLifetime(ptr, this.memory.copyJSValue, this.memory.freeJSValue, this.runtime));
            }
            try {
              let result = yield* awaited(fn.apply(thisHandle, argHandles));
              if (result) {
                if ("error" in result && result.error) throw this.runtime.debugLog("throw error", result.error), result.error;
                let handle = scope.manage(result instanceof Lifetime ? result : result.value);
                return this.ffi.QTS_DupValuePointer(this.ctx.value, handle.value);
              }
              return 0;
            } catch (error) {
              return this.errorToHandle(error).consume((errorHandle) => this.ffi.QTS_Throw(this.ctx.value, errorHandle.value));
            }
          });
        } };
        this.runtime = args.runtime, this.module = args.module, this.ffi = args.ffi, this.rt = args.rt, this.ctx = args.ctx, this.memory = new ContextMemory({ ...args, owner: this.runtime }), args.callbacks.setContextCallbacks(this.ctx.value, this.cToHostCallbacks), this.dump = this.dump.bind(this), this.getString = this.getString.bind(this), this.getNumber = this.getNumber.bind(this), this.resolvePromise = this.resolvePromise.bind(this), this.uint32Out = this.memory.manage(this.memory.newTypedArray(Uint32Array, 1));
      }
      get alive() {
        return this.memory.alive;
      }
      dispose() {
        this.memory.dispose();
      }
      get undefined() {
        if (this._undefined) return this._undefined;
        let ptr = this.ffi.QTS_GetUndefined();
        return this._undefined = new StaticLifetime(ptr);
      }
      get null() {
        if (this._null) return this._null;
        let ptr = this.ffi.QTS_GetNull();
        return this._null = new StaticLifetime(ptr);
      }
      get true() {
        if (this._true) return this._true;
        let ptr = this.ffi.QTS_GetTrue();
        return this._true = new StaticLifetime(ptr);
      }
      get false() {
        if (this._false) return this._false;
        let ptr = this.ffi.QTS_GetFalse();
        return this._false = new StaticLifetime(ptr);
      }
      get global() {
        if (this._global) return this._global;
        let ptr = this.ffi.QTS_GetGlobalObject(this.ctx.value);
        return this._global = this.memory.staticHeapValueHandle(ptr), this._global;
      }
      newNumber(num) {
        return this.memory.heapValueHandle(this.ffi.QTS_NewFloat64(this.ctx.value, num));
      }
      newString(str) {
        let ptr = this.memory.newHeapCharPointer(str).consume((charHandle) => this.ffi.QTS_NewString(this.ctx.value, charHandle.value.ptr));
        return this.memory.heapValueHandle(ptr);
      }
      newUniqueSymbol(description) {
        let key = (typeof description == "symbol" ? description.description : description) ?? "", ptr = this.memory.newHeapCharPointer(key).consume((charHandle) => this.ffi.QTS_NewSymbol(this.ctx.value, charHandle.value.ptr, 0));
        return this.memory.heapValueHandle(ptr);
      }
      newSymbolFor(key) {
        let description = (typeof key == "symbol" ? key.description : key) ?? "", ptr = this.memory.newHeapCharPointer(description).consume((charHandle) => this.ffi.QTS_NewSymbol(this.ctx.value, charHandle.value.ptr, 1));
        return this.memory.heapValueHandle(ptr);
      }
      getWellKnownSymbol(name) {
        return this._Symbol ?? (this._Symbol = this.memory.manage(this.getProp(this.global, "Symbol"))), this.getProp(this._Symbol, name);
      }
      newBigInt(num) {
        if (!this._BigInt) {
          let bigIntHandle2 = this.getProp(this.global, "BigInt");
          this.memory.manage(bigIntHandle2), this._BigInt = new StaticLifetime(bigIntHandle2.value, this.runtime);
        }
        let bigIntHandle = this._BigInt, asString = String(num);
        return this.newString(asString).consume((handle) => this.unwrapResult(this.callFunction(bigIntHandle, this.undefined, handle)));
      }
      newObject(prototype) {
        prototype && this.runtime.assertOwned(prototype);
        let ptr = prototype ? this.ffi.QTS_NewObjectProto(this.ctx.value, prototype.value) : this.ffi.QTS_NewObject(this.ctx.value);
        return this.memory.heapValueHandle(ptr);
      }
      newArray() {
        let ptr = this.ffi.QTS_NewArray(this.ctx.value);
        return this.memory.heapValueHandle(ptr);
      }
      newArrayBuffer(buffer) {
        let array = new Uint8Array(buffer), handle = this.memory.newHeapBufferPointer(array), ptr = this.ffi.QTS_NewArrayBuffer(this.ctx.value, handle.value.pointer, array.length);
        return this.memory.heapValueHandle(ptr);
      }
      newPromise(value) {
        let deferredPromise = Scope.withScope((scope) => {
          let mutablePointerArray = scope.manage(this.memory.newMutablePointerArray(2)), promisePtr = this.ffi.QTS_NewPromiseCapability(this.ctx.value, mutablePointerArray.value.ptr), promiseHandle = this.memory.heapValueHandle(promisePtr), [resolveHandle, rejectHandle] = Array.from(mutablePointerArray.value.typedArray).map((jsvaluePtr) => this.memory.heapValueHandle(jsvaluePtr));
          return new QuickJSDeferredPromise({ context: this, promiseHandle, resolveHandle, rejectHandle });
        });
        return value && typeof value == "function" && (value = new Promise(value)), value && Promise.resolve(value).then(deferredPromise.resolve, (error) => error instanceof Lifetime ? deferredPromise.reject(error) : this.newError(error).consume(deferredPromise.reject)), deferredPromise;
      }
      newFunction(nameOrFn, maybeFn) {
        let fn = typeof nameOrFn == "function" ? nameOrFn : maybeFn;
        if (!fn) throw new TypeError("Expected a function");
        return this.newFunctionWithOptions({ name: typeof nameOrFn == "string" ? nameOrFn : void 0, length: fn.length, isConstructor: false, fn });
      }
      newConstructorFunction(nameOrFn, maybeFn) {
        let fn = typeof nameOrFn == "function" ? nameOrFn : maybeFn;
        if (!fn) throw new TypeError("Expected a function");
        return this.newFunctionWithOptions({ name: typeof nameOrFn == "string" ? nameOrFn : void 0, length: fn.length, isConstructor: true, fn });
      }
      newFunctionWithOptions(args) {
        let { name, length, isConstructor, fn } = args, refId = this.runtime.hostRefs.put(fn);
        try {
          return this.memory.heapValueHandle(this.ffi.QTS_NewFunction(this.ctx.value, name ?? "", length, isConstructor, refId));
        } catch (error) {
          throw this.runtime.hostRefs.delete(refId), error;
        }
      }
      newError(error) {
        let errorHandle = this.memory.heapValueHandle(this.ffi.QTS_NewError(this.ctx.value));
        return error && typeof error == "object" ? (error.name !== void 0 && this.newString(error.name).consume((handle) => this.setProp(errorHandle, "name", handle)), error.message !== void 0 && this.newString(error.message).consume((handle) => this.setProp(errorHandle, "message", handle))) : typeof error == "string" ? this.newString(error).consume((handle) => this.setProp(errorHandle, "message", handle)) : error !== void 0 && this.newString(String(error)).consume((handle) => this.setProp(errorHandle, "message", handle)), errorHandle;
      }
      newHostRef(value) {
        let id = this.runtime.hostRefs.put(value);
        try {
          let handle = this.memory.heapValueHandle(this.ffi.QTS_NewHostRef(this.ctx.value, id));
          return new HostRef(this.runtime, handle, id);
        } catch (error) {
          throw this.runtime.hostRefs.delete(id), error;
        }
      }
      toHostRef(handle) {
        let id = this.ffi.QTS_GetHostRefId(handle.value);
        if (id !== 0) return this.runtime.hostRefs.get(id), new HostRef(this.runtime, handle.dup(), id);
      }
      unwrapHostRef(handle) {
        let id = this.ffi.QTS_GetHostRefId(handle.value);
        if (id === 0) throw new QuickJSHostRefInvalid("handle is not a HostRef");
        return this.runtime.hostRefs.get(id);
      }
      typeof(handle) {
        return this.runtime.assertOwned(handle), this.memory.consumeHeapCharPointer(this.ffi.QTS_Typeof(this.ctx.value, handle.value));
      }
      getNumber(handle) {
        return this.runtime.assertOwned(handle), this.ffi.QTS_GetFloat64(this.ctx.value, handle.value);
      }
      getString(handle) {
        return this.runtime.assertOwned(handle), this.memory.consumeJSCharPointer(this.ffi.QTS_GetString(this.ctx.value, handle.value));
      }
      getSymbol(handle) {
        this.runtime.assertOwned(handle);
        let key = this.memory.consumeJSCharPointer(this.ffi.QTS_GetSymbolDescriptionOrKey(this.ctx.value, handle.value));
        return this.ffi.QTS_IsGlobalSymbol(this.ctx.value, handle.value) ? Symbol.for(key) : Symbol(key);
      }
      getBigInt(handle) {
        this.runtime.assertOwned(handle);
        let asString = this.getString(handle);
        return BigInt(asString);
      }
      getArrayBuffer(handle) {
        this.runtime.assertOwned(handle);
        let len = this.ffi.QTS_GetArrayBufferLength(this.ctx.value, handle.value), ptr = this.ffi.QTS_GetArrayBuffer(this.ctx.value, handle.value);
        if (!ptr) throw new Error("Couldn't allocate memory to get ArrayBuffer");
        return new Lifetime(this.module.HEAPU8.subarray(ptr, ptr + len), void 0, () => this.module._free(ptr));
      }
      getPromiseState(handle) {
        this.runtime.assertOwned(handle);
        let state = this.ffi.QTS_PromiseState(this.ctx.value, handle.value);
        if (state < 0) return { type: "fulfilled", value: handle, notAPromise: true };
        if (state === JSPromiseStateEnum.Pending) return { type: "pending", get error() {
          return new QuickJSPromisePending("Cannot unwrap a pending promise");
        } };
        let ptr = this.ffi.QTS_PromiseResult(this.ctx.value, handle.value), result = this.memory.heapValueHandle(ptr);
        if (state === JSPromiseStateEnum.Fulfilled) return { type: "fulfilled", value: result };
        if (state === JSPromiseStateEnum.Rejected) return { type: "rejected", error: result };
        throw result.dispose(), new Error(`Unknown JSPromiseStateEnum: ${state}`);
      }
      resolvePromise(promiseLikeHandle) {
        this.runtime.assertOwned(promiseLikeHandle);
        let vmResolveResult = Scope.withScope((scope) => {
          let vmPromise = scope.manage(this.getProp(this.global, "Promise")), vmPromiseResolve = scope.manage(this.getProp(vmPromise, "resolve"));
          return this.callFunction(vmPromiseResolve, vmPromise, promiseLikeHandle);
        });
        return vmResolveResult.error ? Promise.resolve(vmResolveResult) : new Promise((resolve) => {
          Scope.withScope((scope) => {
            let resolveHandle = scope.manage(this.newFunction("resolve", (value) => {
              resolve(this.success(value && value.dup()));
            })), rejectHandle = scope.manage(this.newFunction("reject", (error) => {
              resolve(this.fail(error && error.dup()));
            })), promiseHandle = scope.manage(vmResolveResult.value), promiseThenHandle = scope.manage(this.getProp(promiseHandle, "then"));
            this.callFunction(promiseThenHandle, promiseHandle, resolveHandle, rejectHandle).unwrap().dispose();
          });
        });
      }
      isEqual(a, b, equalityType = IsEqualOp.IsStrictlyEqual) {
        if (a === b) return true;
        this.runtime.assertOwned(a), this.runtime.assertOwned(b);
        let result = this.ffi.QTS_IsEqual(this.ctx.value, a.value, b.value, equalityType);
        if (result === -1) throw new QuickJSNotImplemented("WASM variant does not expose equality");
        return !!result;
      }
      eq(handle, other) {
        return this.isEqual(handle, other, IsEqualOp.IsStrictlyEqual);
      }
      sameValue(handle, other) {
        return this.isEqual(handle, other, IsEqualOp.IsSameValue);
      }
      sameValueZero(handle, other) {
        return this.isEqual(handle, other, IsEqualOp.IsSameValueZero);
      }
      getProp(handle, key) {
        this.runtime.assertOwned(handle);
        let ptr;
        return typeof key == "number" && key >= 0 ? ptr = this.ffi.QTS_GetPropNumber(this.ctx.value, handle.value, key) : ptr = this.borrowPropertyKey(key).consume((quickJSKey) => this.ffi.QTS_GetProp(this.ctx.value, handle.value, quickJSKey.value)), this.memory.heapValueHandle(ptr);
      }
      getLength(handle) {
        if (this.runtime.assertOwned(handle), !(this.ffi.QTS_GetLength(this.ctx.value, this.uint32Out.value.ptr, handle.value) < 0)) return this.uint32Out.value.typedArray[0];
      }
      getOwnPropertyNames(handle, options = { strings: true, numbersAsStrings: true }) {
        this.runtime.assertOwned(handle), handle.value;
        let flags = getOwnPropertyNamesOptionsToFlags(options);
        if (flags === 0) throw new QuickJSEmptyGetOwnPropertyNames("No options set, will return an empty array");
        return Scope.withScope((scope) => {
          let outPtr = scope.manage(this.memory.newMutablePointerArray(1)), errorPtr = this.ffi.QTS_GetOwnPropertyNames(this.ctx.value, outPtr.value.ptr, this.uint32Out.value.ptr, handle.value, flags);
          if (errorPtr) return this.fail(this.memory.heapValueHandle(errorPtr));
          let len = this.uint32Out.value.typedArray[0], ptr = outPtr.value.typedArray[0], pointerArray = new Uint32Array(this.module.HEAP8.buffer, ptr, len), handles = Array.from(pointerArray).map((ptr2) => this.memory.heapValueHandle(ptr2));
          return this.ffi.QTS_FreeVoidPointer(this.ctx.value, ptr), this.success(createDisposableArray(handles));
        });
      }
      getIterator(iterableHandle) {
        let SymbolIterator = this._SymbolIterator ?? (this._SymbolIterator = this.memory.manage(this.getWellKnownSymbol("iterator")));
        return Scope.withScope((scope) => {
          let methodHandle = scope.manage(this.getProp(iterableHandle, SymbolIterator)), iteratorCallResult = this.callFunction(methodHandle, iterableHandle);
          return iteratorCallResult.error ? iteratorCallResult : this.success(new QuickJSIterator(iteratorCallResult.value, this));
        });
      }
      setProp(handle, key, value) {
        this.runtime.assertOwned(handle), this.borrowPropertyKey(key).consume((quickJSKey) => this.ffi.QTS_SetProp(this.ctx.value, handle.value, quickJSKey.value, value.value));
      }
      defineProp(handle, key, descriptor) {
        this.runtime.assertOwned(handle), Scope.withScope((scope) => {
          let quickJSKey = scope.manage(this.borrowPropertyKey(key)), value = descriptor.value || this.undefined, configurable = !!descriptor.configurable, enumerable = !!descriptor.enumerable, hasValue = !!descriptor.value, get = descriptor.get ? scope.manage(this.newFunction(descriptor.get.name, descriptor.get)) : this.undefined, set = descriptor.set ? scope.manage(this.newFunction(descriptor.set.name, descriptor.set)) : this.undefined;
          this.ffi.QTS_DefineProp(this.ctx.value, handle.value, quickJSKey.value, value.value, get.value, set.value, configurable, enumerable, hasValue);
        });
      }
      callFunction(func, thisVal, ...restArgs) {
        this.runtime.assertOwned(func);
        let args, firstArg = restArgs[0];
        firstArg === void 0 || Array.isArray(firstArg) ? args = firstArg ?? [] : args = restArgs;
        let resultPtr = this.memory.toPointerArray(args).consume((argsArrayPtr) => this.ffi.QTS_Call(this.ctx.value, func.value, thisVal.value, args.length, argsArrayPtr.value)), errorPtr = this.ffi.QTS_ResolveException(this.ctx.value, resultPtr);
        return errorPtr ? (this.ffi.QTS_FreeValuePointer(this.ctx.value, resultPtr), this.fail(this.memory.heapValueHandle(errorPtr))) : this.success(this.memory.heapValueHandle(resultPtr));
      }
      callMethod(thisHandle, key, args = []) {
        return this.getProp(thisHandle, key).consume((func) => this.callFunction(func, thisHandle, args));
      }
      evalCode(code, filename = "eval.js", options) {
        let detectModule = options === void 0 ? 1 : 0, flags = evalOptionsToFlags(options), resultPtr = this.memory.newHeapCharPointer(code).consume((charHandle) => this.ffi.QTS_Eval(this.ctx.value, charHandle.value.ptr, charHandle.value.strlen, filename, detectModule, flags)), errorPtr = this.ffi.QTS_ResolveException(this.ctx.value, resultPtr);
        return errorPtr ? (this.ffi.QTS_FreeValuePointer(this.ctx.value, resultPtr), this.fail(this.memory.heapValueHandle(errorPtr))) : this.success(this.memory.heapValueHandle(resultPtr));
      }
      throw(error) {
        return this.errorToHandle(error).consume((handle) => this.ffi.QTS_Throw(this.ctx.value, handle.value));
      }
      borrowPropertyKey(key) {
        return typeof key == "number" ? this.newNumber(key) : typeof key == "string" ? this.newString(key) : new StaticLifetime(key.value, this.runtime);
      }
      getMemory(rt) {
        if (rt === this.rt.value) return this.memory;
        throw new Error("Private API. Cannot get memory from a different runtime");
      }
      dump(handle) {
        this.runtime.assertOwned(handle);
        let type = this.typeof(handle);
        if (type === "string") return this.getString(handle);
        if (type === "number") return this.getNumber(handle);
        if (type === "bigint") return this.getBigInt(handle);
        if (type === "undefined") return;
        if (type === "symbol") return this.getSymbol(handle);
        let asPromiseState = this.getPromiseState(handle);
        if (asPromiseState.type === "fulfilled" && !asPromiseState.notAPromise) return handle.dispose(), { type: asPromiseState.type, value: asPromiseState.value.consume(this.dump) };
        if (asPromiseState.type === "pending") return handle.dispose(), { type: asPromiseState.type };
        if (asPromiseState.type === "rejected") return handle.dispose(), { type: asPromiseState.type, error: asPromiseState.error.consume(this.dump) };
        let str = this.memory.consumeJSCharPointer(this.ffi.QTS_Dump(this.ctx.value, handle.value));
        try {
          return JSON.parse(str);
        } catch {
          return str;
        }
      }
      unwrapResult(result) {
        if (result.error) {
          let context = "context" in result.error ? result.error.context : this, cause = result.error.consume((error) => this.dump(error));
          if (cause && typeof cause == "object" && typeof cause.message == "string") {
            let { message, name, stack, ...rest } = cause, exception = new QuickJSUnwrapError(cause, context);
            typeof name == "string" && (exception.name = cause.name), exception.message = message;
            let hostStack = exception.stack;
            throw typeof stack == "string" && (exception.stack = `${name}: ${message}
${cause.stack}Host: ${hostStack}`), Object.assign(exception, rest), exception;
          }
          throw new QuickJSUnwrapError(cause);
        }
        return result.value;
      }
      [Symbol.for("nodejs.util.inspect.custom")]() {
        return this.alive ? `${this.constructor.name} { ctx: ${this.ctx.value} rt: ${this.rt.value} }` : `${this.constructor.name} { disposed }`;
      }
      getFunction(fn_id) {
        let fn = this.runtime.hostRefs.get(fn_id);
        if (typeof fn != "function") throw new Error(`Host reference ${fn_id} is not a function`);
        return fn;
      }
      errorToHandle(error) {
        return error instanceof Lifetime ? error : this.newError(error);
      }
      encodeBinaryJSON(handle) {
        let ptr = this.ffi.QTS_bjson_encode(this.ctx.value, handle.value);
        return this.memory.heapValueHandle(ptr);
      }
      decodeBinaryJSON(handle) {
        let ptr = this.ffi.QTS_bjson_decode(this.ctx.value, handle.value);
        return this.memory.heapValueHandle(ptr);
      }
      success(value) {
        return DisposableResult.success(value);
      }
      fail(error) {
        return DisposableResult.fail(error, (error2) => this.unwrapResult(error2));
      }
    };
    QuickJSRuntime = class extends UsingDisposable {
      constructor(args) {
        super();
        this.scope = new Scope();
        this.contextMap = /* @__PURE__ */ new Map();
        this.hostRefs = new HostRefMap();
        this._debugMode = false;
        this.cToHostCallbacks = { freeHostRef: (rt, host_ref_id) => {
          if (rt !== this.rt.value) throw new Error("Runtime pointer mismatch");
          this.hostRefs.delete(host_ref_id);
        }, shouldInterrupt: (rt) => {
          if (rt !== this.rt.value) throw new Error("QuickJSContext instance received C -> JS interrupt with mismatched rt");
          let fn = this.interruptHandler;
          if (!fn) throw new Error("QuickJSContext had no interrupt handler");
          return fn(this) ? 1 : 0;
        }, loadModuleSource: maybeAsyncFn(this, function* (awaited, rt, ctx, moduleName) {
          let moduleLoader = this.moduleLoader;
          if (!moduleLoader) throw new Error("Runtime has no module loader");
          if (rt !== this.rt.value) throw new Error("Runtime pointer mismatch");
          let context = this.contextMap.get(ctx) ?? this.newContext({ contextPointer: ctx });
          try {
            let result = yield* awaited(moduleLoader(moduleName, context));
            if (typeof result == "object" && "error" in result && result.error) throw this.debugLog("cToHostLoadModule: loader returned error", result.error), result.error;
            let moduleSource = typeof result == "string" ? result : "value" in result ? result.value : result;
            return this.memory.newHeapCharPointer(moduleSource).value.ptr;
          } catch (error) {
            return this.debugLog("cToHostLoadModule: caught error", error), context.throw(error), 0;
          }
        }), normalizeModule: maybeAsyncFn(this, function* (awaited, rt, ctx, baseModuleName, moduleNameRequest) {
          let moduleNormalizer = this.moduleNormalizer;
          if (!moduleNormalizer) throw new Error("Runtime has no module normalizer");
          if (rt !== this.rt.value) throw new Error("Runtime pointer mismatch");
          let context = this.contextMap.get(ctx) ?? this.newContext({ contextPointer: ctx });
          try {
            let result = yield* awaited(moduleNormalizer(baseModuleName, moduleNameRequest, context));
            if (typeof result == "object" && "error" in result && result.error) throw this.debugLog("cToHostNormalizeModule: normalizer returned error", result.error), result.error;
            let name = typeof result == "string" ? result : result.value;
            return context.getMemory(this.rt.value).newHeapCharPointer(name).value.ptr;
          } catch (error) {
            return this.debugLog("normalizeModule: caught error", error), context.throw(error), 0;
          }
        }) };
        args.ownedLifetimes?.forEach((lifetime) => this.scope.manage(lifetime)), this.module = args.module, this.memory = new ModuleMemory(this.module), this.ffi = args.ffi, this.rt = args.rt, this.callbacks = args.callbacks, this.scope.manage(this.rt), this.callbacks.setRuntimeCallbacks(this.rt.value, this.cToHostCallbacks), this.executePendingJobs = this.executePendingJobs.bind(this), QTS_DEBUG && this.setDebugMode(true);
      }
      get alive() {
        return this.scope.alive;
      }
      dispose() {
        return this.scope.dispose();
      }
      newContext(options = {}) {
        let intrinsics = intrinsicsToFlags(options.intrinsics), ctx = new Lifetime(options.contextPointer || this.ffi.QTS_NewContext(this.rt.value, intrinsics), void 0, (ctx_ptr) => {
          this.contextMap.delete(ctx_ptr), this.callbacks.deleteContext(ctx_ptr), this.ffi.QTS_FreeContext(ctx_ptr);
        }), context = new QuickJSContext({ module: this.module, ctx, ffi: this.ffi, rt: this.rt, ownedLifetimes: options.ownedLifetimes, runtime: this, callbacks: this.callbacks });
        return this.contextMap.set(ctx.value, context), context;
      }
      setModuleLoader(moduleLoader, moduleNormalizer) {
        this.moduleLoader = moduleLoader, this.moduleNormalizer = moduleNormalizer, this.ffi.QTS_RuntimeEnableModuleLoader(this.rt.value, this.moduleNormalizer ? 1 : 0);
      }
      removeModuleLoader() {
        this.moduleLoader = void 0, this.ffi.QTS_RuntimeDisableModuleLoader(this.rt.value);
      }
      hasPendingJob() {
        return !!this.ffi.QTS_IsJobPending(this.rt.value);
      }
      setInterruptHandler(cb) {
        let prevInterruptHandler = this.interruptHandler;
        this.interruptHandler = cb, prevInterruptHandler || this.ffi.QTS_RuntimeEnableInterruptHandler(this.rt.value);
      }
      removeInterruptHandler() {
        this.interruptHandler && (this.ffi.QTS_RuntimeDisableInterruptHandler(this.rt.value), this.interruptHandler = void 0);
      }
      executePendingJobs(maxJobsToExecute = -1) {
        let ctxPtrOut = this.memory.newMutablePointerArray(1), valuePtr = this.ffi.QTS_ExecutePendingJob(this.rt.value, maxJobsToExecute ?? -1, ctxPtrOut.value.ptr), ctxPtr = ctxPtrOut.value.typedArray[0];
        if (ctxPtrOut.dispose(), ctxPtr === 0) return this.ffi.QTS_FreeValuePointerRuntime(this.rt.value, valuePtr), DisposableResult.success(0);
        let context = this.contextMap.get(ctxPtr) ?? this.newContext({ contextPointer: ctxPtr }), resultValue = context.getMemory(this.rt.value).heapValueHandle(valuePtr);
        if (context.typeof(resultValue) === "number") {
          let executedJobs = context.getNumber(resultValue);
          return resultValue.dispose(), DisposableResult.success(executedJobs);
        } else {
          let error = Object.assign(resultValue, { context });
          return DisposableResult.fail(error, (error2) => context.unwrapResult(error2));
        }
      }
      setMemoryLimit(limitBytes) {
        if (limitBytes < 0 && limitBytes !== -1) throw new Error("Cannot set memory limit to negative number. To unset, pass -1");
        this.ffi.QTS_RuntimeSetMemoryLimit(this.rt.value, limitBytes);
      }
      computeMemoryUsage() {
        let serviceContextMemory = this.getSystemContext().getMemory(this.rt.value);
        return serviceContextMemory.heapValueHandle(this.ffi.QTS_RuntimeComputeMemoryUsage(this.rt.value, serviceContextMemory.ctx.value));
      }
      dumpMemoryUsage() {
        return this.memory.consumeHeapCharPointer(this.ffi.QTS_RuntimeDumpMemoryUsage(this.rt.value));
      }
      setMaxStackSize(stackSize) {
        if (stackSize < 0) throw new Error("Cannot set memory limit to negative number. To unset, pass 0.");
        this.ffi.QTS_RuntimeSetMaxStackSize(this.rt.value, stackSize);
      }
      assertOwned(handle) {
        if (handle.owner && handle.owner.rt !== this.rt) throw new QuickJSWrongOwner(`Handle is not owned by this runtime: ${handle.owner.rt.value} != ${this.rt.value}`);
      }
      setDebugMode(enabled) {
        this._debugMode = enabled, this.ffi.DEBUG && this.rt.alive && this.ffi.QTS_SetDebugLogEnabled(this.rt.value, enabled ? 1 : 0);
      }
      isDebugMode() {
        return this._debugMode;
      }
      debugLog(...msg) {
        this._debugMode && console.log("quickjs-emscripten:", ...msg);
      }
      [Symbol.for("nodejs.util.inspect.custom")]() {
        return this.alive ? `${this.constructor.name} { rt: ${this.rt.value} }` : `${this.constructor.name} { disposed }`;
      }
      getSystemContext() {
        return this.context || (this.context = this.scope.manage(this.newContext())), this.context;
      }
    };
    QuickJSEmscriptenModuleCallbacks = class {
      constructor(args) {
        this.freeHostRef = args.freeHostRef, this.callFunction = args.callFunction, this.shouldInterrupt = args.shouldInterrupt, this.loadModuleSource = args.loadModuleSource, this.normalizeModule = args.normalizeModule;
      }
    };
    QuickJSModuleCallbacks = class {
      constructor(module2) {
        this.contextCallbacks = /* @__PURE__ */ new Map();
        this.runtimeCallbacks = /* @__PURE__ */ new Map();
        this.suspendedCount = 0;
        this.cToHostCallbacks = new QuickJSEmscriptenModuleCallbacks({ freeHostRef: (_asyncify, rt, host_ref_id) => {
          let runtimeCallbacks = this.runtimeCallbacks.get(rt);
          if (!runtimeCallbacks) throw new Error(`QuickJSRuntime(rt = ${rt}) not found when trying to free HostRef(id = ${host_ref_id})`);
          runtimeCallbacks.freeHostRef(rt, host_ref_id);
        }, callFunction: (asyncify, ctx, this_ptr, argc, argv, fn_id) => this.handleAsyncify(asyncify, () => {
          try {
            let vm = this.contextCallbacks.get(ctx);
            if (!vm) throw new Error(`QuickJSContext(ctx = ${ctx}) not found for C function call "${fn_id}"`);
            return vm.callFunction(ctx, this_ptr, argc, argv, fn_id);
          } catch (error) {
            return console.error("[C to host error: returning null]", error), 0;
          }
        }), shouldInterrupt: (asyncify, rt) => this.handleAsyncify(asyncify, () => {
          try {
            let vm = this.runtimeCallbacks.get(rt);
            if (!vm) throw new Error(`QuickJSRuntime(rt = ${rt}) not found for C interrupt`);
            return vm.shouldInterrupt(rt);
          } catch (error) {
            return console.error("[C to host interrupt: returning error]", error), 1;
          }
        }), loadModuleSource: (asyncify, rt, ctx, moduleName) => this.handleAsyncify(asyncify, () => {
          try {
            let runtimeCallbacks = this.runtimeCallbacks.get(rt);
            if (!runtimeCallbacks) throw new Error(`QuickJSRuntime(rt = ${rt}) not found for C module loader`);
            let loadModule = runtimeCallbacks.loadModuleSource;
            if (!loadModule) throw new Error(`QuickJSRuntime(rt = ${rt}) does not support module loading`);
            return loadModule(rt, ctx, moduleName);
          } catch (error) {
            return console.error("[C to host module loader error: returning null]", error), 0;
          }
        }), normalizeModule: (asyncify, rt, ctx, moduleBaseName, moduleName) => this.handleAsyncify(asyncify, () => {
          try {
            let runtimeCallbacks = this.runtimeCallbacks.get(rt);
            if (!runtimeCallbacks) throw new Error(`QuickJSRuntime(rt = ${rt}) not found for C module loader`);
            let normalizeModule = runtimeCallbacks.normalizeModule;
            if (!normalizeModule) throw new Error(`QuickJSRuntime(rt = ${rt}) does not support module loading`);
            return normalizeModule(rt, ctx, moduleBaseName, moduleName);
          } catch (error) {
            return console.error("[C to host module loader error: returning null]", error), 0;
          }
        }) });
        this.module = module2, this.module.callbacks = this.cToHostCallbacks;
      }
      setRuntimeCallbacks(rt, callbacks) {
        this.runtimeCallbacks.set(rt, callbacks);
      }
      deleteRuntime(rt) {
        this.runtimeCallbacks.delete(rt);
      }
      setContextCallbacks(ctx, callbacks) {
        this.contextCallbacks.set(ctx, callbacks);
      }
      deleteContext(ctx) {
        this.contextCallbacks.delete(ctx);
      }
      handleAsyncify(asyncify, fn) {
        if (asyncify) return asyncify.handleSleep((done) => {
          try {
            let result = fn();
            if (!(result instanceof Promise)) {
              debugLog("asyncify.handleSleep: not suspending:", result), done(result);
              return;
            }
            if (this.suspended) throw new QuickJSAsyncifyError(`Already suspended at: ${this.suspended.stack}
Attempted to suspend at:`);
            this.suspended = new QuickJSAsyncifySuspended(`(${this.suspendedCount++})`), debugLog("asyncify.handleSleep: suspending:", this.suspended), result.then((resolvedResult) => {
              this.suspended = void 0, debugLog("asyncify.handleSleep: resolved:", resolvedResult), done(resolvedResult);
            }, (error) => {
              debugLog("asyncify.handleSleep: rejected:", error), console.error("QuickJS: cannot handle error in suspended function", error), this.suspended = void 0;
            });
          } catch (error) {
            throw debugLog("asyncify.handleSleep: error:", error), this.suspended = void 0, error;
          }
        });
        let value = fn();
        if (value instanceof Promise) throw new Error("Promise return value not supported in non-asyncify context.");
        return value;
      }
    };
    QuickJSWASMModule = class {
      constructor(module2, ffi) {
        this.module = module2, this.ffi = ffi, this.callbacks = new QuickJSModuleCallbacks(module2);
      }
      newRuntime(options = {}) {
        let rt = new Lifetime(this.ffi.QTS_NewRuntime(), void 0, (rt_ptr) => {
          this.ffi.QTS_FreeRuntime(rt_ptr), this.callbacks.deleteRuntime(rt_ptr);
        }), runtime = new QuickJSRuntime({ module: this.module, callbacks: this.callbacks, ffi: this.ffi, rt });
        return applyBaseRuntimeOptions(runtime, options), options.moduleLoader && runtime.setModuleLoader(options.moduleLoader), runtime;
      }
      newContext(options = {}) {
        let runtime = this.newRuntime(), context = runtime.newContext({ ...options, ownedLifetimes: concat(runtime, options.ownedLifetimes) });
        return runtime.context = context, context;
      }
      evalCode(code, options = {}) {
        return Scope.withScope((scope) => {
          let vm = scope.manage(this.newContext());
          applyModuleEvalRuntimeOptions(vm.runtime, options);
          let result = vm.evalCode(code, "eval.js");
          if (options.memoryLimitBytes !== void 0 && vm.runtime.setMemoryLimit(-1), result.error) throw vm.dump(scope.manage(result.error));
          return vm.dump(scope.manage(result.value));
        });
      }
      getWasmMemory() {
        let memory = this.module.quickjsEmscriptenInit?.(() => {
        })?.getWasmMemory?.();
        if (!memory) throw new Error("Variant does not support getting WebAssembly.Memory");
        return memory;
      }
      getFFI() {
        return this.ffi;
      }
    };
  }
});

// node_modules/quickjs-emscripten-core/dist/chunk-TAV5CUKK.mjs
var QuickJSAsyncContext, QuickJSAsyncRuntime, QuickJSAsyncWASMModule;
var init_chunk_TAV5CUKK = __esm({
  "node_modules/quickjs-emscripten-core/dist/chunk-TAV5CUKK.mjs"() {
    init_chunk_V2S4ZYJR();
    QuickJSAsyncContext = class extends QuickJSContext {
      async evalCodeAsync(code, filename = "eval.js", options) {
        let detectModule = options === void 0 ? 1 : 0, flags = evalOptionsToFlags(options), resultPtr = 0;
        try {
          resultPtr = await this.memory.newHeapCharPointer(code).consume((charHandle) => this.ffi.QTS_Eval_MaybeAsync(this.ctx.value, charHandle.value.ptr, charHandle.value.strlen, filename, detectModule, flags));
        } catch (error) {
          throw this.runtime.debugLog("QTS_Eval_MaybeAsync threw", error), error;
        }
        let errorPtr = this.ffi.QTS_ResolveException(this.ctx.value, resultPtr);
        return errorPtr ? (this.ffi.QTS_FreeValuePointer(this.ctx.value, resultPtr), this.fail(this.memory.heapValueHandle(errorPtr))) : this.success(this.memory.heapValueHandle(resultPtr));
      }
      newAsyncifiedFunction(name, fn) {
        return this.newFunction(name, fn);
      }
    };
    QuickJSAsyncRuntime = class extends QuickJSRuntime {
      constructor(args) {
        super(args);
      }
      newContext(options = {}) {
        let intrinsics = intrinsicsToFlags(options.intrinsics), ctx = new Lifetime(this.ffi.QTS_NewContext(this.rt.value, intrinsics), void 0, (ctx_ptr) => {
          this.contextMap.delete(ctx_ptr), this.callbacks.deleteContext(ctx_ptr), this.ffi.QTS_FreeContext(ctx_ptr);
        }), context = new QuickJSAsyncContext({ module: this.module, ctx, ffi: this.ffi, rt: this.rt, ownedLifetimes: [], runtime: this, callbacks: this.callbacks });
        return this.contextMap.set(ctx.value, context), context;
      }
      setModuleLoader(moduleLoader, moduleNormalizer) {
        super.setModuleLoader(moduleLoader, moduleNormalizer);
      }
      setMaxStackSize(stackSize) {
        return super.setMaxStackSize(stackSize);
      }
    };
    QuickJSAsyncWASMModule = class extends QuickJSWASMModule {
      constructor(module2, ffi) {
        super(module2, ffi);
        this.ffi = ffi, this.module = module2;
      }
      newRuntime(options = {}) {
        let rt = new Lifetime(this.ffi.QTS_NewRuntime(), void 0, (rt_ptr) => {
          this.callbacks.deleteRuntime(rt_ptr), this.ffi.QTS_FreeRuntime(rt_ptr);
        }), runtime = new QuickJSAsyncRuntime({ module: this.module, ffi: this.ffi, rt, callbacks: this.callbacks });
        return applyBaseRuntimeOptions(runtime, options), options.moduleLoader && runtime.setModuleLoader(options.moduleLoader), runtime;
      }
      newContext(options = {}) {
        let runtime = this.newRuntime(), lifetimes = options.ownedLifetimes ? options.ownedLifetimes.concat([runtime]) : [runtime], context = runtime.newContext({ ...options, ownedLifetimes: lifetimes });
        return runtime.context = context, context;
      }
      evalCode() {
        throw new QuickJSNotImplemented("QuickJSWASMModuleAsyncify.evalCode: use evalCodeAsync instead");
      }
      evalCodeAsync(code, options) {
        return Scope.withScopeAsync(async (scope) => {
          let vm = scope.manage(this.newContext());
          applyModuleEvalRuntimeOptions(vm.runtime, options);
          let result = await vm.evalCodeAsync(code, "eval.js");
          if (options.memoryLimitBytes !== void 0 && vm.runtime.setMemoryLimit(-1), result.error) throw vm.dump(scope.manage(result.error));
          return vm.dump(scope.manage(result.value));
        });
      }
    };
  }
});

// node_modules/quickjs-emscripten-core/dist/module-asyncify-2EFITU5U.mjs
var module_asyncify_2EFITU5U_exports = {};
__export(module_asyncify_2EFITU5U_exports, {
  QuickJSAsyncWASMModule: () => QuickJSAsyncWASMModule
});
var init_module_asyncify_2EFITU5U = __esm({
  "node_modules/quickjs-emscripten-core/dist/module-asyncify-2EFITU5U.mjs"() {
    init_chunk_TAV5CUKK();
  }
});

// node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/ffi.mjs
var ffi_exports = {};
__export(ffi_exports, {
  QuickJSAsyncFFI: () => QuickJSAsyncFFI
});
var QuickJSAsyncFFI;
var init_ffi = __esm({
  "node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/ffi.mjs"() {
    init_dist();
    QuickJSAsyncFFI = class {
      constructor(module2) {
        this.module = module2;
        this.DEBUG = false;
        this.QTS_Throw = this.module.cwrap("QTS_Throw", "number", ["number", "number"]);
        this.QTS_NewError = this.module.cwrap("QTS_NewError", "number", ["number"]);
        this.QTS_RuntimeSetMemoryLimit = this.module.cwrap("QTS_RuntimeSetMemoryLimit", null, ["number", "number"]);
        this.QTS_RuntimeComputeMemoryUsage = this.module.cwrap("QTS_RuntimeComputeMemoryUsage", "number", ["number", "number"]);
        this.QTS_RuntimeDumpMemoryUsage = this.module.cwrap("QTS_RuntimeDumpMemoryUsage", "number", ["number"]);
        this.QTS_RecoverableLeakCheck = this.module.cwrap("QTS_RecoverableLeakCheck", "number", []);
        this.QTS_BuildIsSanitizeLeak = this.module.cwrap("QTS_BuildIsSanitizeLeak", "number", []);
        this.QTS_RuntimeSetMaxStackSize = this.module.cwrap("QTS_RuntimeSetMaxStackSize", null, ["number", "number"]);
        this.QTS_GetUndefined = this.module.cwrap("QTS_GetUndefined", "number", []);
        this.QTS_GetNull = this.module.cwrap("QTS_GetNull", "number", []);
        this.QTS_GetFalse = this.module.cwrap("QTS_GetFalse", "number", []);
        this.QTS_GetTrue = this.module.cwrap("QTS_GetTrue", "number", []);
        this.QTS_NewHostRef = this.module.cwrap("QTS_NewHostRef", "number", ["number", "number"]);
        this.QTS_GetHostRefId = this.module.cwrap("QTS_GetHostRefId", "number", ["number"]);
        this.QTS_NewRuntime = this.module.cwrap("QTS_NewRuntime", "number", []);
        this.QTS_FreeRuntime = this.module.cwrap("QTS_FreeRuntime", null, ["number"]);
        this.QTS_NewContext = this.module.cwrap("QTS_NewContext", "number", ["number", "number"]);
        this.QTS_FreeContext = this.module.cwrap("QTS_FreeContext", null, ["number"]);
        this.QTS_FreeValuePointer = this.module.cwrap("QTS_FreeValuePointer", null, ["number", "number"]);
        this.QTS_FreeValuePointerRuntime = this.module.cwrap("QTS_FreeValuePointerRuntime", null, ["number", "number"]);
        this.QTS_FreeVoidPointer = this.module.cwrap("QTS_FreeVoidPointer", null, ["number", "number"]);
        this.QTS_FreeCString = this.module.cwrap("QTS_FreeCString", null, ["number", "number"]);
        this.QTS_DupValuePointer = this.module.cwrap("QTS_DupValuePointer", "number", ["number", "number"]);
        this.QTS_NewObject = this.module.cwrap("QTS_NewObject", "number", ["number"]);
        this.QTS_NewObjectProto = this.module.cwrap("QTS_NewObjectProto", "number", ["number", "number"]);
        this.QTS_NewArray = this.module.cwrap("QTS_NewArray", "number", ["number"]);
        this.QTS_NewArrayBuffer = this.module.cwrap("QTS_NewArrayBuffer", "number", ["number", "number", "number"]);
        this.QTS_NewFloat64 = this.module.cwrap("QTS_NewFloat64", "number", ["number", "number"]);
        this.QTS_GetFloat64 = this.module.cwrap("QTS_GetFloat64", "number", ["number", "number"]);
        this.QTS_NewString = this.module.cwrap("QTS_NewString", "number", ["number", "number"]);
        this.QTS_GetString = this.module.cwrap("QTS_GetString", "number", ["number", "number"]);
        this.QTS_GetArrayBuffer = this.module.cwrap("QTS_GetArrayBuffer", "number", ["number", "number"]);
        this.QTS_GetArrayBufferLength = this.module.cwrap("QTS_GetArrayBufferLength", "number", ["number", "number"]);
        this.QTS_NewSymbol = this.module.cwrap("QTS_NewSymbol", "number", ["number", "number", "number"]);
        this.QTS_GetSymbolDescriptionOrKey = assertSync(this.module.cwrap("QTS_GetSymbolDescriptionOrKey", "number", ["number", "number"]));
        this.QTS_GetSymbolDescriptionOrKey_MaybeAsync = this.module.cwrap("QTS_GetSymbolDescriptionOrKey", "number", ["number", "number"]);
        this.QTS_IsGlobalSymbol = this.module.cwrap("QTS_IsGlobalSymbol", "number", ["number", "number"]);
        this.QTS_IsJobPending = this.module.cwrap("QTS_IsJobPending", "number", ["number"]);
        this.QTS_ExecutePendingJob = assertSync(this.module.cwrap("QTS_ExecutePendingJob", "number", ["number", "number", "number"]));
        this.QTS_ExecutePendingJob_MaybeAsync = this.module.cwrap("QTS_ExecutePendingJob", "number", ["number", "number", "number"]);
        this.QTS_GetProp = assertSync(this.module.cwrap("QTS_GetProp", "number", ["number", "number", "number"]));
        this.QTS_GetProp_MaybeAsync = this.module.cwrap("QTS_GetProp", "number", ["number", "number", "number"]);
        this.QTS_GetPropNumber = assertSync(this.module.cwrap("QTS_GetPropNumber", "number", ["number", "number", "number"]));
        this.QTS_GetPropNumber_MaybeAsync = this.module.cwrap("QTS_GetPropNumber", "number", ["number", "number", "number"]);
        this.QTS_SetProp = assertSync(this.module.cwrap("QTS_SetProp", null, ["number", "number", "number", "number"]));
        this.QTS_SetProp_MaybeAsync = this.module.cwrap("QTS_SetProp", null, ["number", "number", "number", "number"]);
        this.QTS_DefineProp = this.module.cwrap("QTS_DefineProp", null, ["number", "number", "number", "number", "number", "number", "boolean", "boolean", "boolean"]);
        this.QTS_GetOwnPropertyNames = assertSync(this.module.cwrap("QTS_GetOwnPropertyNames", "number", ["number", "number", "number", "number", "number"]));
        this.QTS_GetOwnPropertyNames_MaybeAsync = this.module.cwrap("QTS_GetOwnPropertyNames", "number", ["number", "number", "number", "number", "number"]);
        this.QTS_Call = assertSync(this.module.cwrap("QTS_Call", "number", ["number", "number", "number", "number", "number"]));
        this.QTS_Call_MaybeAsync = this.module.cwrap("QTS_Call", "number", ["number", "number", "number", "number", "number"]);
        this.QTS_ResolveException = this.module.cwrap("QTS_ResolveException", "number", ["number", "number"]);
        this.QTS_Dump = assertSync(this.module.cwrap("QTS_Dump", "number", ["number", "number"]));
        this.QTS_Dump_MaybeAsync = this.module.cwrap("QTS_Dump", "number", ["number", "number"]);
        this.QTS_Eval = assertSync(this.module.cwrap("QTS_Eval", "number", ["number", "number", "number", "string", "number", "number"]));
        this.QTS_Eval_MaybeAsync = this.module.cwrap("QTS_Eval", "number", ["number", "number", "number", "string", "number", "number"]);
        this.QTS_GetModuleNamespace = this.module.cwrap("QTS_GetModuleNamespace", "number", ["number", "number"]);
        this.QTS_Typeof = this.module.cwrap("QTS_Typeof", "number", ["number", "number"]);
        this.QTS_GetLength = this.module.cwrap("QTS_GetLength", "number", ["number", "number", "number"]);
        this.QTS_IsEqual = this.module.cwrap("QTS_IsEqual", "number", ["number", "number", "number", "number"]);
        this.QTS_GetGlobalObject = this.module.cwrap("QTS_GetGlobalObject", "number", ["number"]);
        this.QTS_NewPromiseCapability = this.module.cwrap("QTS_NewPromiseCapability", "number", ["number", "number"]);
        this.QTS_PromiseState = this.module.cwrap("QTS_PromiseState", "number", ["number", "number"]);
        this.QTS_PromiseResult = this.module.cwrap("QTS_PromiseResult", "number", ["number", "number"]);
        this.QTS_TestStringArg = this.module.cwrap("QTS_TestStringArg", null, ["string"]);
        this.QTS_GetDebugLogEnabled = this.module.cwrap("QTS_GetDebugLogEnabled", "number", ["number"]);
        this.QTS_SetDebugLogEnabled = this.module.cwrap("QTS_SetDebugLogEnabled", null, ["number", "number"]);
        this.QTS_BuildIsDebug = this.module.cwrap("QTS_BuildIsDebug", "number", []);
        this.QTS_BuildIsAsyncify = this.module.cwrap("QTS_BuildIsAsyncify", "number", []);
        this.QTS_NewFunction = this.module.cwrap("QTS_NewFunction", "number", ["number", "string", "number", "boolean", "number"]);
        this.QTS_ArgvGetJSValueConstPointer = this.module.cwrap("QTS_ArgvGetJSValueConstPointer", "number", ["number", "number"]);
        this.QTS_RuntimeEnableInterruptHandler = this.module.cwrap("QTS_RuntimeEnableInterruptHandler", null, ["number"]);
        this.QTS_RuntimeDisableInterruptHandler = this.module.cwrap("QTS_RuntimeDisableInterruptHandler", null, ["number"]);
        this.QTS_RuntimeEnableModuleLoader = this.module.cwrap("QTS_RuntimeEnableModuleLoader", null, ["number", "number"]);
        this.QTS_RuntimeDisableModuleLoader = this.module.cwrap("QTS_RuntimeDisableModuleLoader", null, ["number"]);
        this.QTS_bjson_encode = this.module.cwrap("QTS_bjson_encode", "number", ["number", "number"]);
        this.QTS_bjson_decode = this.module.cwrap("QTS_bjson_decode", "number", ["number", "number"]);
      }
    };
  }
});

// node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/emscripten-module.browser.mjs
var emscripten_module_browser_exports = {};
__export(emscripten_module_browser_exports, {
  default: () => emscripten_module_browser_default
});
async function QuickJSRaw(moduleArg = {}) {
  var moduleRtn;
  var d = moduleArg, aa = !!globalThis.window, f = !!globalThis.WorkerGlobalScope;
  function m(a) {
    a = { log: a || function() {
    } };
    for (const c of m.eb) c(a);
    return d.quickJSEmscriptenExtensions = a;
  }
  m.eb = [];
  d.quickjsEmscriptenInit = m;
  m.eb.push((a) => {
    a.getWasmMemory = function() {
      return r;
    };
  });
  var t = "./this.program", ba = import.meta.url, w = "", x, y;
  if (aa || f) {
    try {
      w = new URL(".", ba).href;
    } catch {
    }
    f && (y = (a) => {
      var c = new XMLHttpRequest();
      c.open("GET", a, false);
      c.responseType = "arraybuffer";
      c.send(null);
      return new Uint8Array(c.response);
    });
    x = async (a) => {
      a = await fetch(a, { credentials: "same-origin" });
      if (a.ok) return a.arrayBuffer();
      throw Error(a.status + " : " + a.url);
    };
  }
  var z = console.log.bind(console), A = console.error.bind(console), B, C = false, D, E, F, G, H, I, J, K = false;
  function ca() {
    var a = r.buffer;
    d.HEAP8 = G = new Int8Array(a);
    new Int16Array(a);
    d.HEAPU8 = H = new Uint8Array(a);
    new Uint16Array(a);
    I = new Int32Array(a);
    J = new Uint32Array(a);
    new Float32Array(a);
    new Float64Array(a);
    new BigInt64Array(a);
    new BigUint64Array(a);
  }
  function L(a) {
    d.onAbort?.(a);
    a = "Aborted(" + a + ")";
    A(a);
    C = true;
    a = new WebAssembly.RuntimeError(a + ". Build with -sASSERTIONS for more info.");
    F?.(a);
    throw a;
  }
  var M;
  async function da(a) {
    if (!B) try {
      var c = await x(a);
      return new Uint8Array(c);
    } catch {
    }
    if (a == M && B) a = new Uint8Array(B);
    else if (y) a = y(a);
    else throw "both async and sync fetching of the wasm failed";
    return a;
  }
  async function ea(a, c) {
    try {
      var b = await da(a);
      return await WebAssembly.instantiate(b, c);
    } catch (e) {
      A(`failed to asynchronously prepare wasm: ${e}`), L(e);
    }
  }
  async function fa(a) {
    var c = M;
    if (!B) try {
      var b = fetch(c, { credentials: "same-origin" });
      return await WebAssembly.instantiateStreaming(b, a);
    } catch (e) {
      A(`wasm streaming compile failed: ${e}`), A("falling back to ArrayBuffer instantiation");
    }
    return ea(c, a);
  }
  class ha {
    name = "ExitStatus";
    constructor(a) {
      this.message = `Program terminated with exit(${a})`;
      this.status = a;
    }
  }
  var ia = (a) => {
    for (; 0 < a.length; ) a.shift()(d);
  }, ja = [], ka = [], la = () => {
    var a = d.preRun.shift();
    ka.push(a);
  }, N = true, r, ma = new TextDecoder(), na = (a, c, b, e) => {
    b = c + b;
    if (e) return b;
    for (; a[c] && !(c >= b); ) ++c;
    return c;
  }, O = (a, c, b) => a ? ma.decode(H.subarray(a, na(H, a, c, b))) : "", P = 0, oa = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], pa = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], Q = {}, qa = (a) => {
    if (!(a instanceof ha || "unwind" == a)) throw a;
  }, ra = (a) => {
    D = a;
    N || 0 < P || (d.onExit?.(a), C = true);
    throw new ha(a);
  }, R = (a) => {
    if (!C) try {
      return a();
    } catch (c) {
      qa(c);
    } finally {
      if (!(N || 0 < P)) try {
        D = a = D, ra(a);
      } catch (c) {
        qa(c);
      }
    }
  }, S = (a, c, b) => {
    var e = H;
    if (!(0 < b)) return 0;
    var g = c;
    b = c + b - 1;
    for (var h = 0; h < a.length; ++h) {
      var k = a.codePointAt(h);
      if (127 >= k) {
        if (c >= b) break;
        e[c++] = k;
      } else if (2047 >= k) {
        if (c + 1 >= b) break;
        e[c++] = 192 | k >> 6;
        e[c++] = 128 | k & 63;
      } else if (65535 >= k) {
        if (c + 2 >= b) break;
        e[c++] = 224 | k >> 12;
        e[c++] = 128 | k >> 6 & 63;
        e[c++] = 128 | k & 63;
      } else {
        if (c + 3 >= b) break;
        e[c++] = 240 | k >> 18;
        e[c++] = 128 | k >> 12 & 63;
        e[c++] = 128 | k >> 6 & 63;
        e[c++] = 128 | k & 63;
        h++;
      }
    }
    e[c] = 0;
    return c - g;
  }, T = {}, ta = () => {
    if (!U) {
      var a = {
        USER: "web_user",
        LOGNAME: "web_user",
        PATH: "/",
        PWD: "/",
        HOME: "/home/web_user",
        LANG: (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8",
        _: t || "./this.program"
      }, c;
      for (c in T) void 0 === T[c] ? delete a[c] : a[c] = T[c];
      var b = [];
      for (c in a) b.push(`${c}=${a[c]}`);
      U = b;
    }
    return U;
  }, U, V = (a) => {
    for (var c = 0, b = 0; b < a.length; ++b) {
      var e = a.charCodeAt(b);
      127 >= e ? c++ : 2047 >= e ? c += 2 : 55296 <= e && 57343 >= e ? (c += 4, ++b) : c += 3;
    }
    return c;
  }, ua = [null, [], []], W = (a) => {
    try {
      a();
    } catch (c) {
      L(c);
    }
  };
  function va(a) {
    var c = (...b) => {
      X.Sa.push(a);
      try {
        return a(...b);
      } finally {
        C || (X.Sa.pop(), X.Qa && X.state === X.Ra.Za && 0 === X.Sa.length && (X.state = X.Ra.Ua, W(wa), "undefined" != typeof Fibers && Fibers.nb()));
      }
    };
    X.ab.set(a, c);
    return c;
  }
  function xa() {
    return new Promise((a, c) => {
      X.Wa = { resolve: a, reject: c };
    });
  }
  function ya() {
    var a = za(12 + X.Va), c = a + 12, b = X.Va;
    J[a >> 2] = c;
    J[a + 4 >> 2] = c + b;
    c = X.Sa[0];
    X.Xa.has(c) || (b = X.fb++, X.Xa.set(c, b), X.$a.set(b, c));
    c = X.Xa.get(c);
    I[a + 8 >> 2] = c;
    return a;
  }
  function Aa() {
    var a = X.$a.get(I[X.Qa + 8 >> 2]);
    a = X.ab.get(a);
    return R(a);
  }
  var X = { kb(a) {
    var c = /^(qts_host_call_function|qts_host_load_module_source|qts_host_normalize_module|invoke_.*|__asyncjs__.*)$/;
    for (let [b, e] of Object.entries(a)) "function" == typeof e && (e.lb || c.test(b));
  }, Ra: { Ua: 0, Za: 1, Ya: 2, ib: 3 }, state: 0, Va: 81920, Qa: null, cb: 0, Sa: [], Xa: /* @__PURE__ */ new Map(), $a: /* @__PURE__ */ new Map(), ab: /* @__PURE__ */ new Map(), fb: 0, Wa: null, hb: [], Ta(a) {
    if (!C) {
      if (X.state === X.Ra.Ua) {
        var c = false, b = false;
        a((e = 0) => {
          if (!C && (X.cb = e, c = true, b)) {
            X.state = X.Ra.Ya;
            W(() => Ba(X.Qa));
            "undefined" != typeof MainLoop && MainLoop.gb && MainLoop.resume();
            e = false;
            try {
              var g = Aa();
            } catch (p) {
              g = p, e = true;
            }
            var h = false;
            if (!X.Qa) {
              var k = X.Wa;
              k && (X.Wa = null, (e ? k.reject : k.resolve)(g), h = true);
            }
            if (e && !h) throw g;
          }
        });
        b = true;
        c || (X.state = X.Ra.Za, X.Qa = ya(), "undefined" != typeof MainLoop && MainLoop.gb && MainLoop.pause(), W(() => Ca(X.Qa)));
      } else X.state === X.Ra.Ya ? (X.state = X.Ra.Ua, W(Da), Ea(X.Qa), X.Qa = null, X.hb.forEach(R)) : L(`invalid state: ${X.state}`);
      return X.cb;
    }
  }, jb: (a) => X.Ta(async (c) => {
    c(await a());
  }) }, Ha = (a, c, b, e, g) => {
    function h(l) {
      --P;
      0 !== u && Fa(u);
      return "string" === c ? O(l) : "boolean" === c ? !!l : l;
    }
    var k = { string: (l) => {
      var v = 0;
      if (null !== l && void 0 !== l && 0 !== l) {
        v = V(l) + 1;
        var sa = Y(v);
        S(l, sa, v);
        v = sa;
      }
      return v;
    }, array: (l) => {
      var v = Y(l.length);
      G.set(l, v);
      return v;
    } };
    a = d["_" + a];
    var p = [], u = 0;
    if (e) for (var n = 0; n < e.length; n++) {
      var q = k[b[n]];
      q ? (0 === u && (u = Ga()), p[n] = q(e[n])) : p[n] = e[n];
    }
    b = X.Qa;
    e = a(...p);
    g = g?.async;
    P += 1;
    if (X.Qa != b) return xa().then(h);
    e = h(e);
    return g ? Promise.resolve(e) : e;
  };
  d.wasmMemory ? r = d.wasmMemory : r = new WebAssembly.Memory({ initial: (d.INITIAL_MEMORY || 16777216) / 65536, maximum: 32768 });
  ca();
  d.noExitRuntime && (N = d.noExitRuntime);
  d.print && (z = d.print);
  d.printErr && (A = d.printErr);
  d.wasmBinary && (B = d.wasmBinary);
  d.thisProgram && (t = d.thisProgram);
  if (d.preInit) for ("function" == typeof d.preInit && (d.preInit = [d.preInit]); 0 < d.preInit.length; ) d.preInit.shift()();
  d.cwrap = (a, c, b, e) => {
    var g = !b || b.every((h) => "number" === h || "boolean" === h);
    return "string" !== c && g && !e ? d["_" + a] : (...h) => Ha(a, c, b, h, e);
  };
  d.UTF8ToString = O;
  d.stringToUTF8 = (a, c, b) => S(a, c, b);
  d.lengthBytesUTF8 = V;
  d.Asyncify = X;
  var za, Ea, Ia, Fa, Y, Ga, dynCall_iii, dynCall_vii, dynCall_vi, Ca, wa, Ba, Da, Ja = { b: (a, c, b, e) => L(`Assertion failed: ${O(a)}, at: ` + [c ? O(c) : "unknown filename", b, e ? O(e) : "unknown function"]), q: () => L(""), l: () => {
    N = false;
    P = 0;
  }, m: function(a, c) {
    a = -9007199254740992 > a || 9007199254740992 < a ? NaN : Number(a);
    a = new Date(1e3 * a);
    I[c >> 2] = a.getSeconds();
    I[c + 4 >> 2] = a.getMinutes();
    I[c + 8 >> 2] = a.getHours();
    I[c + 12 >> 2] = a.getDate();
    I[c + 16 >> 2] = a.getMonth();
    I[c + 20 >> 2] = a.getFullYear() - 1900;
    I[c + 24 >> 2] = a.getDay();
    var b = a.getFullYear();
    I[c + 28 >> 2] = (0 !== b % 4 || 0 === b % 100 && 0 !== b % 400 ? pa : oa)[a.getMonth()] + a.getDate() - 1 | 0;
    I[c + 36 >> 2] = -(60 * a.getTimezoneOffset());
    b = new Date(a.getFullYear(), 6, 1).getTimezoneOffset();
    var e = new Date(a.getFullYear(), 0, 1).getTimezoneOffset();
    I[c + 32 >> 2] = (b != e && a.getTimezoneOffset() == Math.min(e, b)) | 0;
  }, j: (a, c) => {
    Q[a] && (clearTimeout(Q[a].id), delete Q[a]);
    if (!c) return 0;
    var b = setTimeout(() => {
      delete Q[a];
      R(() => Ia(a, performance.now()));
    }, c);
    Q[a] = { id: b, mb: c };
    return 0;
  }, n: (a, c, b, e) => {
    var g = (/* @__PURE__ */ new Date()).getFullYear(), h = new Date(
      g,
      0,
      1
    ).getTimezoneOffset();
    g = new Date(g, 6, 1).getTimezoneOffset();
    J[a >> 2] = 60 * Math.max(h, g);
    I[c >> 2] = Number(h != g);
    c = (k) => {
      var p = Math.abs(k);
      return `UTC${0 <= k ? "-" : "+"}${String(Math.floor(p / 60)).padStart(2, "0")}${String(p % 60).padStart(2, "0")}`;
    };
    a = c(h);
    c = c(g);
    g < h ? (S(a, b, 17), S(c, e, 17)) : (S(a, e, 17), S(c, b, 17));
  }, p: () => Date.now(), k: (a) => {
    var c = H.length;
    a >>>= 0;
    if (2147483648 < a) return false;
    for (var b = 1; 4 >= b; b *= 2) {
      var e = c * (1 + 0.2 / b);
      e = Math.min(e, a + 100663296);
      a: {
        e = (Math.min(2147483648, 65536 * Math.ceil(Math.max(a, e) / 65536)) - r.buffer.byteLength + 65535) / 65536 | 0;
        try {
          r.grow(e);
          ca();
          var g = 1;
          break a;
        } catch (h) {
        }
        g = void 0;
      }
      if (g) return true;
    }
    return false;
  }, d: (a, c) => {
    var b = 0, e = 0, g;
    for (g of ta()) {
      var h = c + b;
      J[a + e >> 2] = h;
      b += S(g, h, Infinity) + 1;
      e += 4;
    }
    return 0;
  }, e: (a, c) => {
    var b = ta();
    J[a >> 2] = b.length;
    a = 0;
    for (var e of b) a += V(e) + 1;
    J[c >> 2] = a;
    return 0;
  }, c: () => 52, o: function() {
    return 70;
  }, s: (a, c, b, e) => {
    for (var g = 0, h = 0; h < b; h++) {
      var k = J[c >> 2], p = J[c + 4 >> 2];
      c += 8;
      for (var u = 0; u < p; u++) {
        var n = a, q = H[k + u], l = ua[n];
        0 === q || 10 === q ? (n = 1 === n ? z : A, q = na(l, 0), q = ma.decode(l.buffer ? l.subarray(0, q) : new Uint8Array(l.slice(
          0,
          q
        ))), n(q), l.length = 0) : l.push(q);
      }
      g += p;
    }
    J[e >> 2] = g;
    return 0;
  }, a: r, r: ra, i: function(a, c, b, e, g) {
    return d.callbacks.callFunction({ handleSleep: X.Ta }, a, c, b, e, g);
  }, h: function(a) {
    return d.callbacks.shouldInterrupt(void 0, a);
  }, g: function(a, c, b) {
    const e = { handleSleep: X.Ta };
    b = O(b);
    return d.callbacks.loadModuleSource(e, a, c, b);
  }, f: function(a, c, b, e) {
    const g = { handleSleep: X.Ta };
    b = O(b);
    e = O(e);
    return d.callbacks.normalizeModule(g, a, c, b, e);
  }, t: function(a, c) {
    d.callbacks.freeHostRef(void 0, a, c);
  }, u: function(a, c) {
    X.Va = a || c;
  } }, Z;
  Z = await (async function() {
    function a(b) {
      var e = Z = b.exports;
      b = {};
      for (let [g, h] of Object.entries(e)) "function" == typeof h ? (e = va(h), b[g] = e) : b[g] = h;
      b = Z = b;
      za = d._malloc = b.w;
      d._QTS_Throw = b.x;
      d._QTS_NewError = b.y;
      d._QTS_RuntimeSetMemoryLimit = b.z;
      d._QTS_RuntimeComputeMemoryUsage = b.A;
      d._QTS_RuntimeDumpMemoryUsage = b.B;
      d._QTS_RecoverableLeakCheck = b.C;
      d._QTS_BuildIsSanitizeLeak = b.D;
      d._QTS_RuntimeSetMaxStackSize = b.E;
      d._QTS_GetUndefined = b.F;
      d._QTS_GetNull = b.G;
      d._QTS_GetFalse = b.H;
      d._QTS_GetTrue = b.I;
      d._QTS_NewHostRef = b.J;
      d._QTS_GetHostRefId = b.K;
      d._QTS_NewRuntime = b.L;
      d._QTS_FreeRuntime = b.M;
      Ea = d._free = b.N;
      d._QTS_NewContext = b.O;
      d._QTS_FreeContext = b.P;
      d._QTS_FreeValuePointer = b.Q;
      d._QTS_FreeValuePointerRuntime = b.R;
      d._QTS_FreeVoidPointer = b.S;
      d._QTS_FreeCString = b.T;
      d._QTS_DupValuePointer = b.U;
      d._QTS_NewObject = b.V;
      d._QTS_NewObjectProto = b.W;
      d._QTS_NewArray = b.X;
      d._QTS_NewArrayBuffer = b.Y;
      d._QTS_NewFloat64 = b.Z;
      d._QTS_GetFloat64 = b._;
      d._QTS_NewString = b.$;
      d._QTS_GetString = b.aa;
      d._QTS_GetArrayBuffer = b.ba;
      d._QTS_GetArrayBufferLength = b.ca;
      d._QTS_NewSymbol = b.da;
      d._QTS_GetSymbolDescriptionOrKey = b.ea;
      d._QTS_IsGlobalSymbol = b.fa;
      d._QTS_IsJobPending = b.ga;
      d._QTS_ExecutePendingJob = b.ha;
      d._QTS_GetProp = b.ia;
      d._QTS_GetPropNumber = b.ja;
      d._QTS_SetProp = b.ka;
      d._QTS_DefineProp = b.la;
      d._QTS_GetOwnPropertyNames = b.ma;
      d._QTS_Call = b.na;
      d._QTS_ResolveException = b.oa;
      d._QTS_Dump = b.pa;
      d._QTS_Eval = b.qa;
      d._QTS_GetModuleNamespace = b.ra;
      d._QTS_Typeof = b.sa;
      d._QTS_GetLength = b.ta;
      d._QTS_IsEqual = b.ua;
      d._QTS_GetGlobalObject = b.va;
      d._QTS_NewPromiseCapability = b.wa;
      d._QTS_PromiseState = b.xa;
      d._QTS_PromiseResult = b.ya;
      d._QTS_TestStringArg = b.za;
      d._QTS_GetDebugLogEnabled = b.Aa;
      d._QTS_SetDebugLogEnabled = b.Ba;
      d._QTS_BuildIsDebug = b.Ca;
      d._QTS_BuildIsAsyncify = b.Da;
      d._QTS_NewFunction = b.Ea;
      d._QTS_ArgvGetJSValueConstPointer = b.Fa;
      d._QTS_RuntimeEnableInterruptHandler = b.Ga;
      d._QTS_RuntimeDisableInterruptHandler = b.Ha;
      d._QTS_RuntimeEnableModuleLoader = b.Ia;
      d._QTS_RuntimeDisableModuleLoader = b.Ja;
      d._QTS_bjson_encode = b.Ka;
      d._QTS_bjson_decode = b.La;
      Ia = b.Ma;
      Fa = b.Na;
      Y = b.Oa;
      Ga = b.Pa;
      dynCall_iii = b._a;
      dynCall_vii = b.bb;
      dynCall_vi = b.sb;
      Ca = b.tb;
      wa = b.ub;
      Ba = b.vb;
      Da = b.wb;
      return Z;
    }
    var c = { a: Ja };
    if (d.instantiateWasm) return new Promise((b) => {
      d.instantiateWasm(c, (e, g) => {
        b(a(e, g));
      });
    });
    M ??= d.locateFile ? d.locateFile ? d.locateFile("emscripten-module.wasm", w) : w + "emscripten-module.wasm" : new URL("emscripten-module.wasm", import.meta.url).href;
    return a((await fa(c)).instance);
  })();
  (function() {
    function a() {
      d.calledRun = true;
      if (!C) {
        K = true;
        Z.v();
        E?.(d);
        d.onRuntimeInitialized?.();
        if (d.postRun) for ("function" == typeof d.postRun && (d.postRun = [d.postRun]); d.postRun.length; ) {
          var c = d.postRun.shift();
          ja.push(c);
        }
        ia(ja);
      }
    }
    if (d.preRun) for ("function" == typeof d.preRun && (d.preRun = [d.preRun]); d.preRun.length; ) la();
    ia(ka);
    d.setStatus ? (d.setStatus("Running..."), setTimeout(() => {
      setTimeout(() => d.setStatus(""), 1);
      a();
    }, 1)) : a();
  })();
  K ? moduleRtn = d : moduleRtn = new Promise((a, c) => {
    E = a;
    F = c;
  });
  ;
  return moduleRtn;
}
var emscripten_module_browser_default;
var init_emscripten_module_browser = __esm({
  "node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/emscripten-module.browser.mjs"() {
    emscripten_module_browser_default = QuickJSRaw;
  }
});

// node_modules/quickjs-emscripten-core/dist/index.mjs
init_chunk_V2S4ZYJR();
init_dist();
async function newQuickJSAsyncWASMModuleFromVariant(variantOrPromise) {
  let variant2 = smartUnwrap(await variantOrPromise), [wasmModuleLoader, QuickJSAsyncFFI2, { QuickJSAsyncWASMModule: QuickJSAsyncWASMModule2 }] = await Promise.all([variant2.importModuleLoader().then(smartUnwrap), variant2.importFFI(), Promise.resolve().then(() => (init_module_asyncify_2EFITU5U(), module_asyncify_2EFITU5U_exports)).then(smartUnwrap)]), wasmModule2 = await wasmModuleLoader();
  wasmModule2.type = "async";
  let ffi = new QuickJSAsyncFFI2(wasmModule2);
  return new QuickJSAsyncWASMModule2(wasmModule2, ffi);
}
function smartUnwrap(val) {
  return val && "default" in val && val.default ? val.default && "default" in val.default && val.default.default ? val.default.default : val.default : val;
}
function newVariant(baseVariant, options) {
  return { ...baseVariant, async importModuleLoader() {
    let moduleLoader = smartUnwrap(await baseVariant.importModuleLoader());
    return async function() {
      let moduleLoaderArg = options.emscriptenModule ? { ...options.emscriptenModule } : {}, log = options.log ?? ((...args) => debugLog("newVariant moduleLoader:", ...args)), tapValue = (message, val) => (log(...message, val), val), force = (val) => typeof val == "function" ? val() : val;
      (options.wasmLocation || options.wasmSourceMapLocation || options.locateFile) && (moduleLoaderArg.locateFile = (fileName, relativeTo) => {
        let args = { fileName, relativeTo };
        if (fileName.endsWith(".wasm") && options.wasmLocation !== void 0) return tapValue(["locateFile .wasm: provide wasmLocation", args], options.wasmLocation);
        if (fileName.endsWith(".map")) {
          if (options.wasmSourceMapLocation !== void 0) return tapValue(["locateFile .map: provide wasmSourceMapLocation", args], options.wasmSourceMapLocation);
          if (options.wasmLocation && !options.locateFile) return tapValue(["locateFile .map: infer from wasmLocation", args], options.wasmLocation + ".map");
        }
        return options.locateFile ? tapValue(["locateFile: use provided fn", args], options.locateFile(fileName, relativeTo)) : tapValue(["locateFile: unhandled, passthrough", args], fileName);
      }), options.wasmBinary && (moduleLoaderArg.wasmBinary = await force(options.wasmBinary)), options.wasmMemory && (moduleLoaderArg.wasmMemory = await force(options.wasmMemory));
      let optionsWasmModule = options.wasmModule, modulePromise;
      optionsWasmModule && (moduleLoaderArg.instantiateWasm = async (imports, onSuccess) => {
        modulePromise ?? (modulePromise = Promise.resolve(force(optionsWasmModule)));
        let wasmModule2 = await modulePromise;
        if (!wasmModule2) throw new QuickJSEmscriptenModuleError(`options.wasmModule returned ${String(wasmModule2)}`);
        let instance = await WebAssembly.instantiate(wasmModule2, imports);
        return onSuccess(instance), instance.exports;
      }), moduleLoaderArg.monitorRunDependencies = (left) => {
        log("monitorRunDependencies:", left);
      }, moduleLoaderArg.quickjsEmscriptenInit = () => newMockExtensions(log);
      let resultPromise = moduleLoader(moduleLoaderArg), extensions = moduleLoaderArg.quickjsEmscriptenInit?.(log);
      if (optionsWasmModule && extensions?.receiveWasmOffsetConverter && !extensions.existingWasmOffsetConverter) {
        let wasmBinary = await force(options.wasmBinary) ?? new ArrayBuffer(0);
        modulePromise ?? (modulePromise = Promise.resolve(force(optionsWasmModule)));
        let wasmModule2 = await modulePromise;
        if (!wasmModule2) throw new QuickJSEmscriptenModuleError(`options.wasmModule returned ${String(wasmModule2)}`);
        extensions.receiveWasmOffsetConverter(wasmBinary, wasmModule2);
      }
      if (extensions?.receiveSourceMapJSON) {
        let loadedSourceMapData = await force(options.wasmSourceMapData);
        typeof loadedSourceMapData == "string" ? extensions.receiveSourceMapJSON(JSON.parse(loadedSourceMapData)) : loadedSourceMapData ? extensions.receiveSourceMapJSON(loadedSourceMapData) : extensions.receiveSourceMapJSON({ version: 3, names: [], sources: [], mappings: "" });
      }
      return resultPromise;
    };
  } };
}
function newMockExtensions(log) {
  let mockMessage = "mock called, emscripten module may not be initialized yet";
  return { mock: true, removeRunDependency(name) {
    log(`${mockMessage}: removeRunDependency called:`, name);
  }, receiveSourceMapJSON(data) {
    log(`${mockMessage}: receiveSourceMapJSON called:`, data);
  }, WasmOffsetConverter: void 0, receiveWasmOffsetConverter(bytes, mod) {
    log(`${mockMessage}: receiveWasmOffsetConverter called:`, bytes, mod);
  } };
}

// node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/index.mjs
var variant = { type: "async", importFFI: () => Promise.resolve().then(() => (init_ffi(), ffi_exports)).then((mod) => mod.QuickJSAsyncFFI), importModuleLoader: () => Promise.resolve().then(() => (init_emscripten_module_browser(), emscripten_module_browser_exports)).then((mod) => mod.default) };
var src_default = variant;

// host-async.mjs
var SANDBOX_PRELUDE_ASYNC = `
  globalThis.__tools = {};

  globalThis.registerTool = function (def) {
    if (!def || typeof def.name !== "string" || typeof def.handler !== "function") {
      throw new Error("registerTool: definicion invalida");
    }
    globalThis.__tools[def.name] = def;
  };

  globalThis.host = {
    fetchOrigin: function (path, opts) {
      const out = globalThis.__fetchOriginRaw(path, opts ? JSON.stringify(opts) : "");
      return JSON.parse(out);
    },
  };

  // Dispatcher async: espera el handler (que puede ser async).
  globalThis.__dispatch = async function (name, argsJson) {
    const t = globalThis.__tools[name];
    if (!t) throw new Error("tool no encontrada: " + name);
    const args = JSON.parse(argsJson);
    const result = await t.handler(args);
    return JSON.stringify(result === undefined ? null : result);
  };

  globalThis.__list = function () {
    return JSON.stringify(
      Object.values(globalThis.__tools).map(function (t) {
        return {
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || { type: "object" },
        };
      })
    );
  };
`;
var DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
var DEFAULT_MAX_STACK_SIZE_BYTES = 1024 * 1024;
var DEFAULT_INTERRUPT_DEADLINE_MS = 2e3;
var DEFAULT_INTERRUPT_MAX_INVOCATIONS = 2e4;
var DEFAULT_FETCH_TIMEOUT_MS = 1e4;
var AsyncToolHost = class {
  // Opciones: quickjs (modulo asyncify ya construido; recomendado en Workers para
  // evitar top-level await), quickjsModule (WebAssembly.Module pre-compilado),
  // allowedOrigin (obligatorio; unico origin permitido para fetchOrigin),
  // memoryLimitBytes/maxStackSizeBytes/interruptDeadlineMs (<=0 desactiva solo el
  // deadline wall-clock; el gas determinista sigue activo),
  // interruptMaxInvocations (gas determinista; salva contra while(true){}
  // en Workers), fetchImpl (default global fetch; el gateway inyecta uno que enruta
  // origins same-account via service binding, bypass del error 1042 worker-to-worker),
  // fetchTimeoutMs (el gas acota CPU pero no esperas de red), extraCapabilities
  // (mapa nombre->async(argsJson)=>resultJson inyectado como host.<nombre>).
  constructor({ quickjs, quickjsModule, allowedOrigin, memoryLimitBytes, maxStackSizeBytes, interruptDeadlineMs, interruptMaxInvocations, fetchImpl, fetchTimeoutMs, extraCapabilities }) {
    if (typeof allowedOrigin !== "string" || !allowedOrigin) {
      throw new Error("AsyncToolHost requiere allowedOrigin");
    }
    this._quickjs = quickjs || null;
    this._quickjsModule = quickjsModule || null;
    this._allowedOrigin = allowedOrigin;
    this._fetchImpl = typeof fetchImpl === "function" ? fetchImpl : ((u, o) => fetch(u, o));
    this._extraCapabilities = extraCapabilities || null;
    this._fetchTimeoutMs = typeof fetchTimeoutMs === "number" && fetchTimeoutMs > 0 ? fetchTimeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
    this._memoryLimitBytes = typeof memoryLimitBytes === "number" ? memoryLimitBytes : DEFAULT_MEMORY_LIMIT_BYTES;
    this._maxStackSizeBytes = typeof maxStackSizeBytes === "number" ? maxStackSizeBytes : DEFAULT_MAX_STACK_SIZE_BYTES;
    this._interruptDeadlineMs = typeof interruptDeadlineMs === "number" ? interruptDeadlineMs : DEFAULT_INTERRUPT_DEADLINE_MS;
    this._interruptMaxInvocations = typeof interruptMaxInvocations === "number" && interruptMaxInvocations > 0 ? interruptMaxInvocations : DEFAULT_INTERRUPT_MAX_INVOCATIONS;
    this._deadline = Number.MAX_SAFE_INTEGER;
    this._interruptCount = 0;
    this._interruptActive = false;
    this._vm = null;
  }
  // Construye (si hace falta) y cachea el modulo asyncify. En Workers el caller pasa
  // `quickjs` ya construido para evitar un top-level await.
  async _ensureModule() {
    if (!this._quickjs) {
      const variant2 = newVariant(src_default, this._quickjsModule ? { wasmModule: this._quickjsModule } : {});
      this._quickjs = await newQuickJSAsyncWASMModuleFromVariant(variant2);
    }
    return this._quickjs;
  }
  async init() {
    await this._ensureModule();
    const vm = this._quickjs.newContext();
    this._vm = vm;
    try {
      vm.runtime.setMemoryLimit(this._memoryLimitBytes);
    } catch (e) {
      console.warn("[AsyncToolHost] setMemoryLimit no aplicado:", e && e.message);
    }
    try {
      vm.runtime.setMaxStackSize(this._maxStackSizeBytes);
    } catch (e) {
      console.warn("[AsyncToolHost] setMaxStackSize no aplicado:", e && e.message);
    }
    try {
      const host = this;
      vm.runtime.setInterruptHandler(() => {
        if (!host._interruptActive) return false;
        host._interruptCount = host._interruptCount + 1 >>> 0;
        if (host._interruptCount > host._interruptMaxInvocations) return true;
        if (host._interruptDeadlineMs > 0 && Date.now() > host._deadline) return true;
        return false;
      });
    } catch (e) {
      console.warn("[AsyncToolHost] setInterruptHandler no aplicado:", e && e.message);
    }
    const allowedOrigin = this._allowedOrigin;
    const fetchImpl = this._fetchImpl;
    const fetchTimeoutMs = this._fetchTimeoutMs;
    const MAX_BODY_BYTES = 16 * 1024;
    const cap = vm.newFunction("__fetchOriginRaw", async (pathH, optsH) => {
      const path = vm.getString(pathH);
      const optsRaw = vm.getString(optsH);
      let opts = {};
      if (optsRaw) {
        try {
          opts = JSON.parse(optsRaw);
        } catch {
          opts = {};
        }
      }
      const method = (opts && typeof opts.method === "string" ? opts.method : "GET").toUpperCase();
      if (method !== "GET" && method !== "POST") {
        throw new Error("method no permitido: " + method);
      }
      let body = void 0;
      if (opts && opts.body !== void 0 && opts.body !== null) {
        if (typeof opts.body !== "string") {
          throw new Error("body debe ser string");
        }
        if (opts.body.length > MAX_BODY_BYTES) {
          throw new Error("body excede 16KB");
        }
        body = opts.body;
      }
      if (method === "GET" && body !== void 0) {
        throw new Error("body no permitido con GET");
      }
      let contentType = opts && typeof opts.contentType === "string" ? opts.contentType : null;
      if (body !== void 0 && !contentType) {
        contentType = "application/json";
      }
      let url;
      if (/^https?:\/\//i.test(path)) {
        url = new URL(path);
      } else {
        url = new URL(path, allowedOrigin);
      }
      if (url.origin !== allowedOrigin) {
        throw new Error("origin no permitido: " + url.origin);
      }
      const fetchOpts = { method };
      if (body !== void 0) {
        fetchOpts.body = body;
        fetchOpts.headers = { "content-type": contentType };
      }
      fetchOpts.signal = AbortSignal.timeout(fetchTimeoutMs);
      const TIMEOUT_TAG = "__fetchOriginTimeout__";
      let timerId;
      const timeoutP = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error(TIMEOUT_TAG)), fetchTimeoutMs);
      });
      let resp;
      try {
        resp = await Promise.race([fetchImpl(url.href, fetchOpts), timeoutP]);
      } catch (e) {
        const msg = String(e && e.message || e);
        if (msg === TIMEOUT_TAG || fetchOpts.signal && fetchOpts.signal.aborted || /timeout|aborted|abort/i.test(msg)) {
          throw new Error("fetchOrigin timeout");
        }
        throw e;
      } finally {
        clearTimeout(timerId);
      }
      const MAX_RESP_BYTES = 4096;
      let respBody = "";
      if (resp.body && typeof resp.body.getReader === "function") {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        const parts = [];
        let received = 0;
        try {
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
            parts.push(decoder.decode(value, { stream: true }));
            if (received >= MAX_RESP_BYTES) break;
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
          }
        }
        parts.push(decoder.decode());
        respBody = parts.join("");
        if (respBody.length > 4096) respBody = respBody.slice(0, 4096);
      } else {
        const text = await resp.text();
        respBody = text.length > 4096 ? text.slice(0, 4096) : text;
      }
      return vm.newString(JSON.stringify({ status: resp.status, body: respBody }));
    });
    vm.setProp(vm.global, "__fetchOriginRaw", cap);
    cap.dispose();
    const extraCaps = this._extraCapabilities;
    if (extraCaps) {
      for (const name of Object.keys(extraCaps)) {
        const fn = extraCaps[name];
        if (typeof fn !== "function") {
          throw new Error("extraCapabilities: '" + name + "' no es funcion");
        }
        const rawName = "__" + name + "Raw";
        const ecap = vm.newFunction(rawName, async (argsH) => {
          const argsJson = vm.getString(argsH);
          const resultJson = await fn(argsJson);
          return vm.newString(
            typeof resultJson === "string" ? resultJson : JSON.stringify(resultJson === void 0 ? null : resultJson)
          );
        });
        vm.setProp(vm.global, rawName, ecap);
        ecap.dispose();
      }
    }
    const pre = vm.evalCode(SANDBOX_PRELUDE_ASYNC);
    if (pre.error) {
      const msg = vm.dump(pre.error);
      pre.error.dispose();
      throw new Error("fallo el prelude del sandbox async: " + JSON.stringify(msg));
    }
    pre.value.dispose();
    if (extraCaps) {
      const extraHostSrc = Object.keys(extraCaps).map(function(name) {
        return "globalThis.host." + name + " = function (...args) { return JSON.parse(globalThis.__" + name + "Raw(JSON.stringify(args)));};";
      }).join("\n");
      const ex = vm.evalCode(extraHostSrc);
      if (ex.error) {
        const msg = vm.dump(ex.error);
        ex.error.dispose();
        throw new Error("fallo al inyectar extraCapabilities: " + JSON.stringify(msg));
      }
      ex.value.dispose();
    }
  }
  // Carga y ejecuta un tool.js (sincrono: se auto-registra). Codigo NO CONFIABLE
  // (viene del origin) => activa el interrupt para cortar bucles en el top-level.
  loadToolSource(sourceText) {
    const vm = this._vm;
    const prevDeadline = this._deadline;
    const prevActive = this._interruptActive;
    this._deadline = Date.now() + this._interruptDeadlineMs;
    this._interruptCount = 0;
    this._interruptActive = true;
    try {
      const res = vm.evalCode(sourceText);
      if (res.error) {
        const msg = vm.dump(res.error);
        res.error.dispose();
        throw new Error("fallo al cargar tool.js: " + JSON.stringify(msg));
      }
      res.value.dispose();
    } finally {
      this._interruptActive = prevActive;
      this._deadline = prevDeadline;
    }
  }
  // MCP: tools/list (sincrono).
  listTools() {
    const vm = this._vm;
    const fn = vm.getProp(vm.global, "__list");
    const res = vm.callFunction(fn, vm.undefined);
    fn.dispose();
    if (res.error) {
      const msg = vm.dump(res.error);
      res.error.dispose();
      throw new Error("listTools fallo: " + JSON.stringify(msg));
    }
    const json = vm.getString(res.value);
    res.value.dispose();
    return JSON.parse(json);
  }
  // MCP: tools/call (async). __dispatch devuelve una Promise QuickJS que
  // desenrollamos con getPromiseState + executePendingJobs, cediendo al event loop
  // para que asyncify reanude la pila wasm cuando el fetch del host resuelve.
  async callTool(name, args) {
    const vm = this._vm;
    const prevDeadline = this._deadline;
    const prevActive = this._interruptActive;
    this._deadline = Date.now() + this._interruptDeadlineMs;
    this._interruptCount = 0;
    this._interruptActive = true;
    try {
      return await this._callToolInner(name, args);
    } finally {
      this._interruptActive = prevActive;
      this._deadline = prevDeadline;
    }
  }
  async _callToolInner(name, args) {
    const vm = this._vm;
    const code = "__dispatch(" + JSON.stringify(name) + ", " + JSON.stringify(JSON.stringify(args ?? {})) + ")";
    const res = await vm.evalCodeAsync(code);
    if (res.error) {
      const dumped = vm.dump(res.error);
      res.error.dispose();
      const message = dumped && typeof dumped === "object" && dumped.message ? dumped.message : typeof dumped === "string" ? dumped : JSON.stringify(dumped);
      throw new Error(message);
    }
    let st = vm.getPromiseState(res.value);
    let guard = 0;
    while (st.type === "pending" && guard++ < 1e3) {
      vm.runtime.executePendingJobs(1);
      st = vm.getPromiseState(res.value);
      if (st.type === "pending") {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (st.type === "rejected") {
      const dumped = vm.dump(st.error);
      st.error.dispose();
      res.value.dispose();
      const message = dumped && typeof dumped === "object" && dumped.message ? dumped.message : typeof dumped === "string" ? dumped : JSON.stringify(dumped);
      throw new Error(message);
    }
    if (st.type !== "fulfilled") {
      res.value.dispose();
      throw new Error("tool: la promesa no se resolvio (timeout de bombeo)");
    }
    const json = vm.getString(st.value);
    st.value.dispose();
    res.value.dispose();
    return JSON.parse(json);
  }
  dispose() {
    if (this._vm) this._vm.dispose();
  }
};

// llmstxt-parse.mjs
var SKILLS_HEADING_RE = /^##\s+skills\s*$/i;
var HEADING2_RE = /^##\s+/;
var LINE_RE = /^\s*-\s+\[([^\]]+)\]\(([^)]*)\):\s*(.*?)\s*(?:<!--\s*skill:\s*(\{.*?\})\s*-->)?\s*$/;
var MEMORY_RE = /^\s*<!--\s*skills-memory:\s*(\{.*?\})\s*-->\s*$/;
function parseLlmsTxt(text) {
  if (typeof text !== "string") return { skills: [], nonExecutable: [], memory: null, memories: [] };
  const skills = [];
  const nonExecutable = [];
  const memories = [];
  let memory = null;
  let inSkillsSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const stripped = rawLine.trim();
    if (SKILLS_HEADING_RE.test(stripped)) {
      inSkillsSection = true;
      continue;
    }
    if (inSkillsSection && HEADING2_RE.test(stripped)) {
      inSkillsSection = false;
    }
    if (inSkillsSection) {
      const m = rawLine.match(LINE_RE);
      if (m) {
        const name = m[1];
        const url = m[2];
        const description = m[3];
        const metaRaw = m[4];
        let meta = null;
        let metaError = false;
        if (metaRaw) {
          try {
            meta = JSON.parse(metaRaw);
          } catch {
            metaError = true;
          }
        }
        if (meta && typeof meta === "object" && typeof meta.tool === "string" && typeof meta.tool_sha256 === "string" && (meta.scope === void 0 || typeof meta.scope === "string" && /^[a-z][a-z0-9_-]*$/.test(meta.scope))) {
          skills.push({
            name,
            description,
            toolPath: meta.tool,
            sha256: meta.tool_sha256,
            version: typeof meta.version === "string" ? meta.version : void 0,
            // La OTRA mitad de la skill: la receta (SKILL.md). `url` es el enlace
            // de la propia linea; meta.sha256 (core RFC) es su hash declarado.
            // Los runtimes la exponen como MCP resource (resources/*).
            skillPath: url,
            skillSha256: typeof meta.sha256 === "string" ? meta.sha256 : void 0,
            // Scope (ext v0.5 SS2.5): namespace declarativo para origins
            // multi-proyecto; el runtime expone <scope>__<name>.
            scope: typeof meta.scope === "string" ? meta.scope : void 0
          });
        } else {
          let reason;
          if (!metaRaw) {
            reason = "sin metadata inline (skill de prosa, solo enlace)";
          } else if (metaError) {
            reason = "metadata JSON invalida";
          } else if (meta && meta.scope !== void 0 && !(typeof meta.scope === "string" && /^[a-z][a-z0-9_-]*$/.test(meta.scope))) {
            reason = "scope invalido (patron ^[a-z][a-z0-9_-]*$, ext v0.5 SS2.5)";
          } else {
            reason = "no declara 'tool'/'tool_sha256' (skill de prosa, ver SKILL.md)";
          }
          nonExecutable.push({ name, url, description, reason });
        }
        continue;
      }
    }
    {
      const mm = rawLine.match(MEMORY_RE);
      if (mm) {
        let memMeta;
        try {
          memMeta = JSON.parse(mm[1]);
        } catch {
          continue;
        }
        if (memMeta && typeof memMeta === "object" && typeof memMeta.snapshot === "string" && typeof memMeta.snapshot_sha256 === "string" && typeof memMeta.format === "string" && (memMeta.scope === void 0 || typeof memMeta.scope === "string" && /^[a-z][a-z0-9_-]*$/.test(memMeta.scope))) {
          const scopeKey = typeof memMeta.scope === "string" ? memMeta.scope : "";
          if (!memories.some((m) => (m.scope || "") === scopeKey)) {
            const entry = {
              snapshot: memMeta.snapshot,
              snapshot_sha256: memMeta.snapshot_sha256,
              format: memMeta.format,
              unsupported: memMeta.format !== "minimemory-okf-v1",
              scope: memMeta.scope
            };
            memories.push(entry);
            if (memory === null && memMeta.scope === void 0) memory = entry;
          }
        }
      }
    }
  }
  return { skills, nonExecutable, memory, memories };
}

// web/mcpwasm-web.mjs
var MAX_TOOL_BYTES = 256 * 1024;
var MAX_SKILLMD_BYTES = 256 * 1024;
var MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
async function sha256Normalized(text) {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n"));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function resolvePath(origin, path) {
  return new URL(path, origin + "/").toString();
}
async function fetchText(url, maxBytes, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = await res.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new Error(`${label}: excede el limite de ${maxBytes} bytes`);
  }
  return text;
}
function makeMemorySearch(engineFactory, snapshotText) {
  let idx = null;
  return async (argsJson) => {
    let q = null;
    let k = 5;
    try {
      const parsed = JSON.parse(argsJson || "[]");
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      const second = Array.isArray(parsed) ? parsed[1] : void 0;
      if (typeof first === "string") q = first;
      else if (first && typeof first === "object" && typeof first.q === "string") {
        q = first.q;
        if (typeof first.k === "number" && Number.isFinite(first.k)) k = Math.floor(first.k);
      }
      if (typeof second === "number" && Number.isFinite(second)) k = Math.floor(second);
    } catch {
      return JSON.stringify({ error: "memorySearch: args JSON invalido" });
    }
    if (typeof q !== "string" || !q.trim()) return JSON.stringify({ error: "memorySearch: query (q) string obligatorio" });
    k = Math.min(Math.max(k, 1), 10);
    try {
      if (!idx) idx = engineFactory(snapshotText);
      const hits = idx.search(q, k).map((h) => ({
        text: typeof h.snippet === "string" ? h.snippet : "",
        score: h.score,
        title: typeof h.title === "string" ? h.title : typeof h.concept_id === "string" ? h.concept_id : "",
        concept_id: typeof h.concept_id === "string" ? h.concept_id : ""
      }));
      return JSON.stringify({ hits });
    } catch (e) {
      return JSON.stringify({ error: "memorySearch: " + String(e && e.message || e) });
    }
  };
}
async function connectStaticSkills(origin, options = {}) {
  const log = typeof options.onLog === "function" ? options.onLog : () => {
  };
  const originUrl = new URL(origin);
  const allowedOrigin = originUrl.origin;
  const qw = options.quickjsWasm ?? options.quickjsWasmUrl;
  if (!qw) throw new Error("connectStaticSkills: falta quickjsWasm (URL, bytes o Module)");
  log("compilando QuickJS-wasm...");
  let quickjsModule;
  if (qw instanceof WebAssembly.Module) quickjsModule = qw;
  else if (typeof qw === "string") quickjsModule = await WebAssembly.compileStreaming(fetch(qw));
  else quickjsModule = await WebAssembly.compile(qw);
  log(`descubriendo skills de ${allowedOrigin} ...`);
  const llmsText = await fetchText(allowedOrigin + "/llms.txt", 1024 * 1024, "llms.txt");
  const parsed = parseLlmsTxt(llmsText);
  for (const ne of parsed.nonExecutable) {
    log(`skill de prosa (no ejecutable): ${ne.name} \u2014 ${ne.reason}`);
  }
  const memories = parsed.memories || [];
  const engines = {};
  let engineFactory = null;
  const mmw = options.minimemoryWasm ?? options.minimemoryWasmUrl;
  if (memories.length && mmw && typeof options.minimemoryInit === "function") {
    const wasmBytes = typeof mmw === "string" ? await (await fetch(mmw)).arrayBuffer() : mmw;
    const WasmOkfIndex2 = options.minimemoryInit(wasmBytes);
    engineFactory = (snapshotText) => {
      const idx = new WasmOkfIndex2();
      idx.import_snapshot(snapshotText);
      return { search: (q, k) => JSON.parse(idx.search(q, k)) };
    };
  }
  for (const mem of memories) {
    const scopeKey = mem.scope || "";
    const label = mem.scope ? `origin-memory[${mem.scope}]` : "origin-memory";
    if (mem.unsupported) {
      log(`${label}: formato '${mem.format}' no soportado \u2014 se ignora`);
      continue;
    }
    if (!engineFactory) {
      log(`${label}: motor BM25 no configurado \u2014 memoria ausente (fail-closed)`);
      continue;
    }
    try {
      const snapText = await fetchText(resolvePath(allowedOrigin, mem.snapshot), MAX_SNAPSHOT_BYTES, label);
      const actual = await sha256Normalized(snapText);
      if (actual !== mem.snapshot_sha256) {
        log(`${label}: snapshot sha256 mismatch \u2014 capability NO inyectada`);
        continue;
      }
      engines[scopeKey] = makeMemorySearch(engineFactory, snapText);
      log(`${label}: snapshot verificado -> host.memorySearch inyectada`);
    } catch (e) {
      log(`${label}: ${e.message} \u2014 memoria ausente`);
    }
  }
  const routes = /* @__PURE__ */ new Map();
  const order = [];
  const tools = [];
  const recipes = {};
  const rejected = [];
  const loadedPublic = /* @__PURE__ */ new Set();
  for (const s of parsed.skills) {
    const publicName = s.scope ? `${s.scope}__${s.name}` : s.name;
    if (loadedPublic.has(publicName)) {
      rejected.push({ name: s.name, reason: `nombre publico '${publicName}' ya cargado (colision; ext v0.5 SS2.5)` });
      log(`skill rechazada: ${s.name} \u2014 colision de nombre publico '${publicName}'`);
      continue;
    }
    let code;
    try {
      code = await fetchText(resolvePath(allowedOrigin, s.toolPath), MAX_TOOL_BYTES, `tool.js de ${s.name}`);
    } catch (e) {
      rejected.push({ name: s.name, reason: e.message });
      log(`skill rechazada: ${s.name} \u2014 ${e.message}`);
      continue;
    }
    const actual = await sha256Normalized(code);
    if (actual !== s.sha256) {
      rejected.push({ name: s.name, reason: "tool_sha256 mismatch" });
      log(`skill rechazada: ${s.name} \u2014 tool_sha256 mismatch (declarado ${s.sha256.slice(0, 12)}..., real ${actual.slice(0, 12)}...)`);
      continue;
    }
    const extra = engines[s.scope || ""] ? { memorySearch: engines[s.scope || ""] } : null;
    const host = new AsyncToolHost({
      quickjsModule,
      allowedOrigin,
      extraCapabilities: extra
    });
    try {
      await host.init();
      host.loadToolSource(code);
    } catch (e) {
      rejected.push({ name: s.name, reason: `no cargo: ${e.message}` });
      log(`skill rechazada: ${s.name} \u2014 no cargo: ${e.message}`);
      continue;
    }
    loadedPublic.add(publicName);
    for (const t of host.listTools()) {
      const pub = s.scope ? `${s.scope}__${t.name}` : t.name;
      if (routes.has(pub)) {
        log(`tool omitida: '${pub}' ya registrada (colision de nombre publico)`);
        continue;
      }
      routes.set(pub, { host, internal: t.name });
      order.push(pub);
      tools.push({ ...t, name: pub, verified_sha256: s.sha256 });
    }
    log(`skill verificada y cargada: ${publicName} (sha ${s.sha256.slice(0, 12)}...)`);
    if (s.skillPath && s.skillSha256) {
      try {
        const md = await fetchText(resolvePath(allowedOrigin, s.skillPath), MAX_SKILLMD_BYTES, `SKILL.md de ${s.name}`);
        if (await sha256Normalized(md) === s.skillSha256) {
          recipes[publicName] = md;
        } else {
          log(`receta omitida: ${publicName} \u2014 SKILL.md sha256 mismatch (la tool carga igual)`);
        }
      } catch (e) {
        log(`receta omitida: ${publicName} \u2014 ${e.message}`);
      }
    }
  }
  if (tools.length === 0) {
    throw new Error(`sin skills ejecutables verificadas en ${allowedOrigin} (${rejected.length} rechazadas)`);
  }
  log(`listo: ${order.length} tool(s) verificadas (${order.join(", ")})`);
  return {
    origin: allowedOrigin,
    tools,
    recipes,
    rejected,
    async callTool(name, args = {}) {
      const r = routes.get(name);
      if (!r) throw new Error(`tool no encontrada: ${name}`);
      return r.host.callTool(r.internal, args);
    },
    dispose() {
      const seen = /* @__PURE__ */ new Set();
      for (const { host } of routes.values()) {
        if (seen.has(host)) continue;
        seen.add(host);
        try {
          host.dispose?.();
        } catch {
        }
      }
      routes.clear();
    }
  };
}

// node_modules/@rckflr/minimemory/minimemory.js
var WasmOkfIndex = class _WasmOkfIndex {
  static __wrap(ptr) {
    const obj = Object.create(_WasmOkfIndex.prototype);
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
        ptr1 = 0;
        len1 = 0;
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
        ptr3 = 0;
        len3 = 0;
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
    return _WasmOkfIndex.__wrap(ret[0]);
  }
};
if (Symbol.dispose) WasmOkfIndex.prototype[Symbol.dispose] = WasmOkfIndex.prototype.free;
var WasmVectorDB = class _WasmVectorDB {
  static __wrap(ptr) {
    const obj = Object.create(_WasmVectorDB.prototype);
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
        ptr1 = 0;
        len1 = 0;
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
        ptr2 = 0;
        len2 = 0;
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
        ptr1 = 0;
        len1 = 0;
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
        ptr2 = 0;
        len2 = 0;
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
        ptr3 = 0;
        len3 = 0;
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
    return _WasmVectorDB.__wrap(ret[0]);
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
    return _WasmVectorDB.__wrap(ret[0]);
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
    return _WasmVectorDB.__wrap(ret[0]);
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
    return _WasmVectorDB.__wrap(ret[0]);
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
    const ret = wasm.wasmvectordb_new_with_config(dimensions, ptr0, len0, ptr1, len1, ptr2, len2, isLikeNone(hnsw_m) ? Number.MAX_SAFE_INTEGER : hnsw_m >>> 0, isLikeNone(hnsw_ef) ? Number.MAX_SAFE_INTEGER : hnsw_ef >>> 0);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return _WasmVectorDB.__wrap(ret[0]);
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
        ptr2 = 0;
        len2 = 0;
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
        ptr2 = 0;
        len2 = 0;
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
        ptr2 = 0;
        len2 = 0;
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
        ptr3 = 0;
        len3 = 0;
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
};
if (Symbol.dispose) WasmVectorDB.prototype[Symbol.dispose] = WasmVectorDB.prototype.free;
function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
      const ret = Error(getStringFromWasm0(arg0, arg1));
      return ret;
    },
    __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
      const ret = typeof arg0 === "function";
      return ret;
    },
    __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
      const val = arg0;
      const ret = typeof val === "object" && val !== null;
      return ret;
    },
    __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
      const ret = typeof arg0 === "string";
      return ret;
    },
    __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
      const ret = arg0 === void 0;
      return ret;
    },
    __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_call_a6e5c5dce5018821: function() {
      return handleError(function(arg0, arg1, arg2) {
        const ret = arg0.call(arg1, arg2);
        return ret;
      }, arguments);
    },
    __wbg_crypto_38df2bab126b63dc: function(arg0) {
      const ret = arg0.crypto;
      return ret;
    },
    __wbg_getRandomValues_c44a50d8cfdaebeb: function() {
      return handleError(function(arg0, arg1) {
        arg0.getRandomValues(arg1);
      }, arguments);
    },
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
    __wbg_randomFillSync_6c25eac9869eb53c: function() {
      return handleError(function(arg0, arg1) {
        arg0.randomFillSync(arg1);
      }, arguments);
    },
    __wbg_require_b4edbdcf3e2a1ef0: function() {
      return handleError(function() {
        const ret = module.require;
        return ret;
      }, arguments);
    },
    __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
      const ret = typeof global === "undefined" ? null : global;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
      const ret = typeof globalThis === "undefined" ? null : globalThis;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_SELF_146583524fe1469b: function() {
      const ret = typeof self === "undefined" ? null : self;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
      const ret = typeof window === "undefined" ? null : window;
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
      const ret = getArrayU8FromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_cast_0000000000000002: function(arg0, arg1) {
      const ret = getStringFromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_init_externref_table: function() {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, void 0);
      table.set(offset + 0, void 0);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    }
  };
  return {
    __proto__: null,
    "./minimemory_bg.js": import0
  };
}
var WasmOkfIndexFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_wasmokfindex_free(ptr, 1));
var WasmVectorDBFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_wasmvectordb_free(ptr, 1));
function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_externrefs.set(idx, obj);
  return idx;
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
  if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
    cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32ArrayMemory0;
}
function getStringFromWasm0(ptr, len) {
  return decodeText(ptr >>> 0, len);
}
var cachedUint8ArrayMemory0 = null;
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
  return x === void 0 || x === null;
}
function passArrayF32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getFloat32ArrayMemory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127) break;
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
var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
var cachedTextEncoder = new TextEncoder();
if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
}
var WASM_VECTOR_LEN = 0;
var wasmModule;
var wasmInstance;
var wasm;
function __wbg_finalize_init(instance, module2) {
  wasmInstance = instance;
  wasm = instance.exports;
  wasmModule = module2;
  cachedFloat32ArrayMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}
function initSync(module2) {
  if (wasm !== void 0) return wasm;
  if (module2 !== void 0) {
    if (Object.getPrototypeOf(module2) === Object.prototype) {
      ({ module: module2 } = module2);
    } else {
      console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
    }
  }
  const imports = __wbg_get_imports();
  if (!(module2 instanceof WebAssembly.Module)) {
    module2 = new WebAssembly.Module(module2);
  }
  const instance = new WebAssembly.Instance(module2, imports);
  return __wbg_finalize_init(instance, module2);
}
export {
  WasmOkfIndex,
  connectStaticSkills,
  initSync as minimemoryInitSync
};
