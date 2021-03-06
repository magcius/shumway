/* -*- Mode: js; js-indent-level: 2; indent-tabs-mode: nil; tab-width: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
 * Copyright 2013 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*global slice, formatErrorMessage, throwErrorFromVM, AVM2 */

function scriptProperties(namespace, props) {
  return props.reduce(function (o, p) {
    o[p] = namespace + " " + p;
    return o;
  }, {});
}

function cloneObject(obj) {
  var clone = Object.create(null);
  for (var prop in obj)
    clone[prop] = obj[prop];
  return clone;
}

// e.g. throwError("ArgumentError", Errors.InvalidEnumError, "blendMode");
// "ArgumentError: Error #2008: Parameter blendMode must be one of the accepted values."
function throwError(name, error) {
  var message = formatErrorMessage.apply(null, slice.call(arguments, 1));
  throwErrorFromVM(AVM2.currentDomain(), name, message, error.code);
}

function sortByDepth(a, b) {
  var levelA = a._level;
  var levelB = b._level;

  if (a._parent !== b._parent && a._index > -1 && b._index > -1) {
    while (a._level > levelB) {
      a = a._parent;
    }
    while (b._level > levelA) {
      b = b._parent;
    }
    while (a._level > 1) {
      if (a._parent === b._parent) {
        break;
      }
      a = a._parent;
      b = b._parent;
    }
  }

  if (a === b) {
    return levelA - levelB;
  }

  return a._index - b._index;
}
function sortNumeric(a, b) {
  return a - b;
}

var Promise = (function PromiseClosure() {
  function isPromise(obj) {
    return typeof obj === 'object' && obj !== null &&
      typeof obj.then === 'function';
  }
  function defaultOnFulfilled(value) {
    return value;
  }
  function defaultOnRejected(reason) {
    throw reason;
  }

  function propagateFulfilled(subject, value) {
    subject.subpromisesValue = value;
    var subpromises = subject.subpromises;
    if (!subpromises) {
      return;
    }
    for (var i = 0; i < subpromises.length; i++) {
      subpromises[i].fulfill(value);
    }
    delete subject.subpromises;
  }
  function propagateRejected(subject, reason) {
    subject.subpromisesReason = reason;
    var subpromises = subject.subpromises;
    if (!subpromises) {
      return;
    }
    for (var i = 0; i < subpromises.length; i++) {
      subpromises[i].reject(reason);
    }
    delete subject.subpromises;
  }

  function performCall(callback, arg, subject) {
    try {
      var value = callback(arg);
      if (isPromise(value)) {
        value.then(function Promise_queueCall_onFulfilled(value) {
          propagateFulfilled(subject, value);
        }, function Promise_queueCall_onRejected(reason) {
          propagateRejected(subject, reason);
        });
        return;
      }

      propagateFulfilled(subject, value);
    } catch (ex) {
      propagateRejected(subject, ex);
    }
  }

  var queue = [];
  function processQueue() {
    while (queue.length > 0) {
      var task = queue[0];
      if (task.directCallback) {
        task.callback.call(task.subject, task.arg);
      } else {
        performCall(task.callback, task.arg, task.subject);
      }
      queue.shift();
    }
  }

  function queueCall(callback, arg, subject, directCallback) {
    if (queue.length === 0) {
      setTimeout(processQueue, 0);
    }
    queue.push({callback: callback, arg: arg, subject: subject,
                directCallback: directCallback});
  }

  function Promise(onFulfilled, onRejected) {
    this.state = 'pending';
    this.onFulfilled = typeof onFulfilled === 'function' ?
      onFulfilled : defaultOnFulfilled;
    this.onRejected = typeof onRejected === 'function' ?
      onRejected : defaultOnRejected;
  }
  Promise.prototype = {
    fulfill: function Promise_resolve(value) {
      if (this.state !== 'pending') {
        return;
      }
      this.state = 'fulfilled';
      this.value = value;
      queueCall(this.onFulfilled, value, this, false);
    },
    reject: function Promise_reject(reason) {
      if (this.state !== 'pending') {
        return;
      }
      this.state = 'rejected';
      this.reason = reason;
      queueCall(this.onRejected, reason, this, false);
    },
    then: function Promise_then(onFulfilled, onRejected) {
      var promise = new Promise(onFulfilled, onRejected);
      if ('subpromisesValue' in this) {
        queueCall(promise.fulfill, this.subpromisesValue, promise, true);
      } else if ('subpromisesReason' in this) {
        queueCall(promise.reject, this.subpromisesReason, promise, true);
      } else {
        var subpromises = this.subpromises || (this.subpromises = []);
        subpromises.push(promise);
      }
      return promise;
    },
    get resolved() {
      return this.state === 'fulfilled';
    },
    resolve: function (value) {
      this.fulfill(value);
    }
  };

  Promise.when = function Promise_when() {
    var promise = new Promise();
    if (arguments.length === 0) {
      promise.resolve();
      return promise;
    }
    var promises = slice.call(arguments, 0);
    var result = [];
    var i = 1;
    function fulfill(value) {
      result.push(value);
      if (i < promises.length) {
        promises[i++].then(fulfill, reject);
      } else {
        promise.resolve(result);
      }
      return value;
    }
    function reject(reason) {
      promise.reject(reason);
    }
    promises[0].then(fulfill, reject);
    return promise;
  };

  return Promise;
})();

var QuadTree = function (x, y, width, height, level) {
  this.x = x || 0;
  this.y = y || 0;
  this.width = width || 0;
  this.height = height || 0;
  this.level = level || 0;
  this.objects = [];
  this.nodes = [];
};
QuadTree.prototype._findIndex = function (obj) {
  var midX = this.x + (this.width / 2);
  var midY = this.y + (this.height / 2);

  var top = obj.y < midY && obj.y + obj.height < midY;
  var bottom = obj.y > midY;

  if (obj.x < midX && obj.x + obj.width < midX) {
    if (top) {
      return 1;
    } else if(bottom) {
      return 2;
    }
  } else if (obj.x > midX) {
    if (top) {
      return 0;
    } else if(bottom) {
      return 3;
    }
  }

  return -1;
};
QuadTree.prototype.insert = function (obj) {
  var objects = this.objects;
  var nodes = this.nodes;

  if (nodes.length) {
    var index = this._findIndex(obj);

    if (index > -1) {
      nodes[index].insert(obj);
      return;
    }
  }

  objects.push(obj);

  if (objects.length > 4 && this.level < 10) {
    if (!nodes.length) {
      this._subdivide();
    }

    for (var i = 0; i < objects.length;) {
      var index = this._findIndex(objects[i]);
      if (index > -1) {
        nodes[index].insert(objects.splice(i, 1)[0]);
      } else {
        objects[i]._qtree = this;
        i++;
      }
    }

    return;
  }

  obj._qtree = this;
};
QuadTree.prototype.retrieve = function (obj) {
  var out = this.objects;

  var nodes = this.nodes;
  if (nodes.length) {
    var index = this._findIndex(obj);

    if (index > -1) {
      out = out.concat(nodes[index].retrieve(obj));
    } else {
      for (var i = 0; i < nodes.length; i++) {
        out = out.concat(nodes[i].retrieve(obj));
      }
    }
  }

  return out;
};
QuadTree.prototype._subdivide = function () {
  var halfWidth = this.width / 2;
  var halfHeight = this.height / 2;
  var midX = this.x + halfWidth;
  var midY = this.y + halfHeight;
  var level = this.level + 1;
  this.nodes[0] = new QuadTree(this.x, this.y, halfWidth, halfHeight, level);
  this.nodes[1] = new QuadTree(midX, this.y, halfWidth, halfHeight, level);
  this.nodes[2] = new QuadTree(this.x, midY, halfWidth, halfHeight, level);
  this.nodes[3] = new QuadTree(midX, midY, halfWidth, halfHeight, level);
};
