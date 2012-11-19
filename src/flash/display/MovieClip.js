var MovieClipDefinition = (function () {
  var def = {
    __class__: 'flash.display.MovieClip',

    initialize: function () {
      this._currentFrame = 0;
      this._currentFrameLabel = null;
      this._currentLabel = false;
      this._currentScene = { };
      this._depthMap = [];
      this._enabled = null;
      this._frameScripts = { };
      this._frameLabels = { };
      this._framesLoaded = 1;
      this._isPlaying = true;
      this._scenes = { };
      this._timeline = null;
      this._totalFrames = 1;
      this._scenes = { };

      var s = this.symbol;
      if (s) {
        this._timeline = s.timeline || null;
        this._framesLoaded = s.framesLoaded || 1;
        this._frameLabels = s.frameLabels || {};
        this._totalFrames = s.totalFrames || 1;
      }
    },

    _callFrame: function (frameNum) {
      if (frameNum in this._frameScripts) {
        var scripts = this._frameScripts[frameNum];
        for (var i = 0, n = scripts.length; i < n; i++)
          scripts[i].call(this);
      }
    },
    _getAS2Object: function () {
      if (!this.$as2Object) {
        new AS2MovieClip().$attachNativeObject(this);
      }
      return this.$as2Object;
    },
    _insertChildAtDepth: function (instance, depth) {
      var children = this._children;
      var depthMap = this._depthMap;
      var current = depthMap[depth];
      var highestDepth = depthMap.length;
      var replace = false;
      var index;
      if (current && current._owned) {
        replace = true;
        index = children.indexOf(current);
      } else {
        var top = null;
        for (var i = +depth + 1; i < highestDepth; i++) {
          var info = depthMap[i];
          if (info && info._animated) {
            top = info;
            break;
          }
        }

        index = top ? children.indexOf(top) : children.length;
      }

      children.splice(index, replace, instance);
      depthMap[depth] = instance;

      if (replace)
        this._control.replaceChild(instance._control, current._control);
      else
        this._control.appendChild(instance._control);

      instance.dispatchEvent(new flash.events.Event("added"));
    },

    _constructSymbol: function(symbolId, name) {
      var loader = this.loaderInfo._loader;
      var symbolPromise = loader._dictionary[symbolId];
      var symbolInfo = symbolPromise.value;
      // HACK application domain may have the symbol class --
      // checking which domain has a symbol class
      var symbolClass = avm2.systemDomain.findClass(symbolInfo.className) ?
        avm2.systemDomain.getClass(symbolInfo.className) :
        avm2.applicationDomain.getClass(symbolInfo.className);
      var instance = symbolClass.createAsSymbol(symbolInfo.props);

      // If we bound the instance to a name, set it.
      //
      // XXX: I think this always has to be a trait.
      if (name)
        this[Multiname.getPublicQualifiedName(name)] = instance;

      // Call the constructor now that we've made the symbol instance,
      // instantiated all its children, and set the display list-specific
      // properties.
      //
      // XXX: I think we're supposed to throw if the symbol class
      // constructor is not nullary.
      symbolClass.instance.call(instance);

      instance._markAsDirty();

      instance._animated = true;
      instance._owned = true;
      instance._parent = this;
      instance._name = name || null;

      instance.dispatchEvent(new flash.events.Event("load"));

      return instance;
    },

    _gotoFrame: function (frameNum, scene) {
      if (frameNum > this._totalFrames)
        frameNum = 1;

      if (frameNum > this.framesLoaded)
        frameNum = this.framesLoaded;

      var currentFrame = this._currentFrame;

      if (frameNum === currentFrame)
        return;

      if (frameNum === 0) {
        // HACK there is no data for this frame, but AS2 can jump to this frame index
        this._currentFrame = 0;
        return;
      }

      while (currentFrame++ < frameNum) {
        var children = this._children;
        var depthMap = this._depthMap;
        var framePromise = this._timeline[currentFrame - 1];
        var highestDepth = depthMap.length;
        var displayList = framePromise.value;
        var loader = this.loaderInfo._loader;

        for (var depth in displayList) {
          this._markAsDirty();

          var cmd = displayList[depth];
          var current = depthMap[depth];
          if (cmd === null) {
            if (current && current._owned) {
              var index = children.indexOf(current);
              var removed = children.splice(index, 1);
              this._control.removeChild(current._control);

              removed[0].dispatchEvent(new flash.events.Event("removed"));

              if (depth < highestDepth)
                depthMap[depth] = undefined;
              else
                depthMap.splice(-1);
            }
          } else {
            var clipDepth = cmd.clipDepth;
            var cxform = cmd.cxform;
            var matrix = cmd.matrix;
            var target;

            if (cmd.symbolId) {
              var name = cmd.name;
              var events = cmd.hasEvents ? cmd.events : null;
              var instance = this._constructSymbol(cmd.symbolId, name);
              if (!loader._isAvm2Enabled) {
                this._initAvm1Bindings(instance, name, events);
              }
              this._insertChildAtDepth(instance, depth);
              if (current && current._owned) {
                if (!clipDepth)
                  clipDepth = current._clipDepth;
                if (!cxform)
                  cxform = current._cxform;
                if (!matrix)
                  matrix = current._currentTransform;
              }
              target = instance;
            } else if (current && current._animated) {
              target = current;
            }

            if (clipDepth)
              target._clipDepth = clipDepth;
            if (cxform)
              target._cxform = cxform;

            if (matrix) {
              var a = matrix.a;
              var b = matrix.b;
              var c = matrix.c;
              var d = matrix.d;

              target._rotation = Math.atan2(b, a) * 180 / Math.PI;
              var sx = Math.sqrt(a * a + b * b);
              target._scaleX = a > 0 ? sx : -sx;
              var sy = Math.sqrt(d * d + c * c);
              target._scaleY = d > 0 ? sy : -sy;
              var x = target._x = matrix.tx;
              var y = target._y = matrix.ty;

              target._currentTransform = matrix;
            }
          }
        }
      }

      this._currentFrame = frameNum;
      this._requestCallFrame();
    },
    _requestCallFrame: function () {
       this._scriptExecutionPending = true;
       this.stage._callFrameRequested = true;
    },
    _initAvm1Bindings: function (instance, name, events) {
      var loader = this.loaderInfo._loader;
      var avm1Context = loader._avm1Context;
      var symbolProps = instance.symbol;
      if (symbolProps.frameScripts) {
        var frameScripts = symbolProps.frameScripts;
        for (var i = 0; i < frameScripts.length; i += 2) {
            var frameIndex = frameScripts[i];
            var actionBlock = frameScripts[i + 1];
            instance.addFrameScript(frameIndex, function(actionBlock) {
              return executeActions(actionBlock, avm1Context, this._getAS2Object());
            }.bind(instance, actionBlock));
        }
      }
      if (symbolProps.variableName) {
        var variableName = symbolProps.variableName;
        var i = variableName.lastIndexOf('.');
        var clip;
        if (i >= 0) {
          var targetPath = variableName.substring(0, i).split('.');
          if (targetPath[0] == '_root') {
            clip = this.root._getAS2Object();
            targetPath.shift();
          } else {
            clip = instance._getAS2Object();
          }
          while (targetPath.length > 0) {
            if (!(targetPath[0] in clip))
              throw 'Cannot find ' + variableName + ' variable';
            clip = clip[targetPath.shift()];
          }
          variableName = variableName.substring(i + 1);
        } else
          clip = instance._getAS2Object();
        if (!(variableName in clip))
          clip[variableName] = instance.text;
        instance._refreshAS2Variables = function() {
          instance.text = clip[variableName];
        };
      }

      if (events) {
        var eventsBound = [];
        for (var i = 0; i < events.length; i++) {
          var event = events[i];
          if (event.eoe) {
            break;
          }
          var fn = function(actionBlock) {
            return executeActions(actionBlock, avm1Context, this._getAS2Object());
          }.bind(instance, event.actionsData);
          for (var eventName in event) {
            if (eventName.indexOf("on") !== 0 || !event[eventName])
              continue;
            var avm2EventName = eventName[2].toLowerCase() + eventName.substring(3);
            this.addEventListener(avm2EventName, fn, false);
            eventsBound.push({name: avm2EventName, fn: fn});
          }
        }
        if (eventsBound.length > 0) {
          instance.addEventListener('removed', function (eventsBound) {
            for (var i = 0; i < eventsBound.length; i++) {
              this.removeEventListener(eventsBound[i].name, eventsBound[i].fn, false);
            }
          }.bind(this, eventsBound), false);
        }
      }
      if (name) {
        this._getAS2Object()[name] = instance._getAS2Object();
      }
    },

    get currentFrame() {
      return this._currentFrame;
    },
    get currentFrameLabel() {
      return this._currentFrameLabel;
    },
    get currentLabel() {
      return this._currentLabel;
    },
    get currentLabels() {
      return this._currentScene.labels;
    },
    get currentScene() {
      return this._currentScene;
    },
    get enabled() {
      return this._enabled;
    },
    set enabled(val) {
      this._enabled = val;
    },
    get framesLoaded() {
      return this._framesLoaded;
    },
    get totalFrames() {
      return this._totalFrames;
    },
    get trackAsMenu() {
      return false;
    },
    set trackAsMenu(val) {
      notImplemented();
    },

    addFrameScript: function () {
      // arguments are pairs of frameIndex and script/function
      // frameIndex is in range 0..totalFrames-1
      var frameScripts = this._frameScripts;
      for (var i = 0, n = arguments.length; i < n; i += 2) {
        var frameNum = arguments[i] + 1;
        var fn = arguments[i + 1];
        var scripts = frameScripts[frameNum];
        if (scripts)
          scripts.push(fn);
        else
          frameScripts[frameNum] = [fn];
      }
    },
    gotoAndPlay: function (frame, scene) {
      this.play();
      if (isNaN(frame))
        this.gotoLabel(frame);
      else
        this._gotoFrame(frame);
    },
    gotoAndStop: function (frame, scene) {
      this.stop();
      if (isNaN(frame))
        this.gotoLabel(frame);
      else
        this._gotoFrame(frame);
    },
    gotoLabel: function (labelName) {
      var frameLabel = this._frameLabels[labelName];
      if (frameLabel)
        this._gotoFrame(frameLabel.frame);
    },
    isPlaying: function () {
      return this._isPlaying;
    },
    nextFrame: function () {
      this.gotoAndPlay(this._currentFrame % this._totalFrames + 1);
    },
    nextScene: function () {
      notImplemented();
    },
    play: function () {
      this._isPlaying = true;
    },
    prevFrame: function () {
      this.gotoAndStop(this._currentFrame > 1 ? this._currentFrame - 1 : this._totalFrames);
    },
    prevScene: function () {
      notImplemented();
    },
    stop: function () {
      this._isPlaying = false;
    }
  };

  var desc = Object.getOwnPropertyDescriptor;

  def.__glue__ = {
    native: {
      instance: {
        currentFrame: desc(def, "currentFrame"),
        framesLoaded: desc(def, "framesLoaded"),
        totalFrames: desc(def, "totalFrames"),
        trackAsMenu: desc(def, "trackAsMenu"),
        scenes: desc(def, "scenes"),
        currentScene: desc(def, "currentScene"),
        currentLabel: desc(def, "currentLabel"),
        currentFrameLabel: desc(def, "currentFrameLabel"),
        enabled: desc(def, "enabled"),
        isPlaying: desc(def, "isPlaying"),
        play: def.play,
        stop: def.stop,
        nextFrame: def.nextFrame,
        prevFrame: def.prevFrame,
        gotoAndPlay: def.gotoAndPlay,
        gotoAndStop: def.gotoAndStop,
        addFrameScript: def.addFrameScript,
        prevScene: def.prevScene,
        nextScene: def.nextScene
      }
    }
  };

  return def;
}).call(this);
