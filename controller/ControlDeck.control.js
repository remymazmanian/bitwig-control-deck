loadAPI(18);

host.defineController("Control Deck", "Control Deck Bridge", "1.1.0", "BC47EFA3-FFD7-4155-9AE6-164DB3E58E89");
host.defineMidiPorts(1, 1);
// Control Deck's native macOS helper publishes these private virtual endpoints. They
// give Bitwig a device identity for auto-add; control data uses an authenticated
// local UDP channel that never leaves this Mac.
host.addDeviceNameBasedDiscoveryPair(["Control Deck Bridge In"], ["Control Deck Bridge Out"]);

var CONTROL_DECK_VERSION = "1.1.0";
var CONTROL_DECK_PROTOCOL = "control-deck/1";
var CONTROL_DECK_PORT = 50701;
// Stamped with a per-install secret by `npm run setup`. The bridge refuses to
// start while the placeholder is still in place.
var CONTROL_DECK_TOKEN = "__CONTROL_DECK_TOKEN__";
var MAX_TRACKS = 128;
var MAX_DEVICES = 64;
var MAX_SCENES = 8;
// Highest launcher slot or scene the tools accept. Bitwig shows MAX_SCENES of
// them at a time, and withSceneSlot scrolls that window to reach the rest.
var MAX_SCENE_SLOTS = 1024;
var MAX_CUE_MARKERS = 256;
// Longest stretch one launcher print records: about 92 seconds at 666 BPM,
// inside the print's 115-second limit.
var MAX_PRINT_SPAN_BEATS = 1024;
var BROWSER_PAGE = 128;
var MAX_BROWSER_RESULTS = 16384;
var CLIP_GRID_WIDTH = 256;
var CLIP_GRID_HEIGHT = 128;
// Largest reply sent back in one datagram. Mirrors MAX_PACKET_BYTES in
// src/bitwig-client.mjs, which reads replies on a 65536-byte socket buffer.
var MAX_REPLY_BYTES = 60000;

var application;
var arranger;
var cueMarkerBank;
var project;
var transport;
var trackBank;
var cursorTrack;
var trackIsCursor = [];
var deviceBank;
var cursorDevice;
var cursorDeviceSlot;
var cursorRemoteControlsPage;
var nestedDeviceBank;
var launcherClip;
var sceneBank;
var popupBrowser;
var resultColumn;
var resultBank;
var deviceTypeBank;
var categoryBank;
var tagBank;
var fileTypeBank;
var creatorBank;
var directIds = [];
var directNames = {};
var directValues = {};
var directDisplays = {};
var directDisplayObserver;
var saveToLibraryAction;
var jumpToBeginningAction;
var trackMeterLatest = [];
var trackMeterMaximum = [];
var requestQueue = [];
var requestBusy = false;
var currentRequest = null;
// Requests from older clients carry no timeout; outlast the longest tool call.
var DEFAULT_REQUEST_LIMIT_MS = 130000;

function interested(value) {
   value.markInterested();
   return value;
}

// Every delayed step runs through here. An exception in a step used to leave the
// bridge busy forever; now it fails the request that scheduled the step instead.
// Steps of a request that already finished, failed or timed out are dropped, so
// they can't keep changing Bitwig or schedule steps under the next request.
function later(delay, callback) {
   var owner = currentRequest;
   host.scheduleTask(function() {
      if (owner && owner.done) return;
      try {
         callback();
      } catch (error) {
         host.errorln("Control Deck step error: " + error);
         if (owner && !owner.done) finish(owner, false, { message: String(error.message || error) });
      }
   }, delay);
}

function arrayCopy(values) {
   var copy = [];
   if (!values) return copy;
   for (var i = 0; i < values.length; i++) copy.push(String(values[i]));
   return copy;
}

function normalizeText(value) {
   return String(value || "").toLowerCase().trim();
}

function unsignedByte(value) {
   var number = Number(value);
   return number < 0 ? number + 256 : number;
}

function decodeUtf8(bytes) {
   var result = "";
   var index = 0;
   while (index < bytes.length) {
      var first = unsignedByte(bytes[index++]);
      var codePoint;
      if (first < 128) {
         codePoint = first;
      } else if ((first & 224) === 192 && index < bytes.length) {
         codePoint = ((first & 31) << 6) | (unsignedByte(bytes[index++]) & 63);
      } else if ((first & 240) === 224 && index + 1 < bytes.length) {
         codePoint = ((first & 15) << 12) |
            ((unsignedByte(bytes[index++]) & 63) << 6) |
            (unsignedByte(bytes[index++]) & 63);
      } else if ((first & 248) === 240 && index + 2 < bytes.length) {
         codePoint = ((first & 7) << 18) |
            ((unsignedByte(bytes[index++]) & 63) << 12) |
            ((unsignedByte(bytes[index++]) & 63) << 6) |
            (unsignedByte(bytes[index++]) & 63);
      } else {
         codePoint = 65533;
      }

      if (codePoint <= 65535) result += String.fromCharCode(codePoint);
      else {
         codePoint -= 65536;
         result += String.fromCharCode(55296 + (codePoint >> 10), 56320 + (codePoint & 1023));
      }
   }
   return result;
}

function signedByte(value) {
   return value > 127 ? value - 256 : value;
}

function encodeUtf8(value) {
   var text = String(value);
   var bytes = [];
   for (var index = 0; index < text.length; index++) {
      var codePoint = text.charCodeAt(index);
      if (codePoint >= 55296 && codePoint <= 56319 && index + 1 < text.length) {
         var second = text.charCodeAt(index + 1);
         if (second >= 56320 && second <= 57343) {
            codePoint = 65536 + ((codePoint - 55296) << 10) + (second - 56320);
            index++;
         }
      }

      if (codePoint < 128) {
         bytes.push(signedByte(codePoint));
      } else if (codePoint < 2048) {
         bytes.push(signedByte(192 | (codePoint >> 6)));
         bytes.push(signedByte(128 | (codePoint & 63)));
      } else if (codePoint < 65536) {
         bytes.push(signedByte(224 | (codePoint >> 12)));
         bytes.push(signedByte(128 | ((codePoint >> 6) & 63)));
         bytes.push(signedByte(128 | (codePoint & 63)));
      } else {
         bytes.push(signedByte(240 | (codePoint >> 18)));
         bytes.push(signedByte(128 | ((codePoint >> 12) & 63)));
         bytes.push(signedByte(128 | ((codePoint >> 6) & 63)));
         bytes.push(signedByte(128 | (codePoint & 63)));
      }
   }
   return bytes;
}

function readTransport() {
   return {
      playing: transport.isPlaying().get(),
      recording: transport.isArrangerRecordEnabled().get(),
      tempo: transport.tempo().value().getRaw(),
      tempoDisplay: transport.tempo().value().displayedValue().get(),
      positionBeats: transport.getPosition().get()
   };
}

function cueMarkerSnapshot(marker, index) {
   return {
      index: index,
      name: marker.name().get(),
      positionBeats: marker.position().get()
   };
}

function listCueMarkers() {
   var total = cueMarkerBank.itemCount().get();
   var count = Math.min(total, MAX_CUE_MARKERS);
   var markers = [];
   for (var index = 0; index < count; index++) {
      var marker = cueMarkerBank.getItemAt(index);
      if (marker.exists().get()) markers.push(cueMarkerSnapshot(marker, index));
   }
   return {
      total: total,
      returned: markers.length,
      truncated: total > MAX_CUE_MARKERS,
      markers: markers
   };
}

function cueMarkerAtPosition(positionBeats) {
   var count = Math.min(cueMarkerBank.itemCount().get(), MAX_CUE_MARKERS);
   for (var index = 0; index < count; index++) {
      var marker = cueMarkerBank.getItemAt(index);
      if (marker.exists().get() && Math.abs(marker.position().get() - positionBeats) < 0.0001) {
         return { marker: marker, index: index };
      }
   }
   return null;
}

function cueMarkerFingerprintCounts() {
   var counts = {};
   var count = Math.min(cueMarkerBank.itemCount().get(), MAX_CUE_MARKERS);
   for (var index = 0; index < count; index++) {
      var marker = cueMarkerBank.getItemAt(index);
      if (!marker.exists().get()) continue;
      var key = JSON.stringify([marker.name().get(), marker.position().get()]);
      counts[key] = Number(counts[key] || 0) + 1;
   }
   return counts;
}

function trackSnapshot(track, index) {
   return {
      index: index,
      reference: "track:" + track.position().get() + ":" + track.name().get(),
      name: track.name().get(),
      type: track.trackType().get(),
      position: track.position().get(),
      mute: track.mute().get(),
      solo: track.solo().get(),
      arm: track.arm().get(),
      volumeNormalized: track.volume().get(),
      volumeDisplay: track.volume().displayedValue().get(),
      panNormalized: track.pan().get(),
      panDisplay: track.pan().displayedValue().get()
   };
}

function listTracks() {
   var total = trackBank.itemCount().get();
   var count = Math.min(total, MAX_TRACKS);
   var tracks = [];
   for (var i = 0; i < count; i++) {
      var track = trackBank.getItemAt(i);
      if (track.exists().get()) tracks.push(trackSnapshot(track, i));
   }
   return { total: total, returned: tracks.length, truncated: total > MAX_TRACKS, tracks: tracks };
}

function readTrackMeters(resetAfterRead) {
   var total = Math.min(trackBank.itemCount().get(), MAX_TRACKS);
   var meters = [];
   for (var i = 0; i < total; i++) {
      var track = trackBank.getItemAt(i);
      if (!track.exists().get()) continue;
      meters.push({
         index: i,
         name: track.name().get(),
         latest: Number(trackMeterLatest[i] || 0),
         maximum: Number(trackMeterMaximum[i] || 0),
         maximumNormalized: Number(trackMeterMaximum[i] || 0) / 127
      });
      if (resetAfterRead) trackMeterMaximum[i] = Number(trackMeterLatest[i] || 0);
   }
   return { range: 128, meters: meters };
}

function requireTrack(params) {
   var index = Number(params.trackIndex);
   if (index < 0 || index >= MAX_TRACKS || index >= trackBank.itemCount().get()) {
      throw new Error("Track index " + index + " is not available. Refresh with bitwig_tracks.");
   }
   var track = trackBank.getItemAt(index);
   if (!track.exists().get()) throw new Error("Track " + index + " no longer exists.");
   var currentName = track.name().get();
   if (currentName !== String(params.trackName)) {
      throw new Error("Safety check failed: track " + index + " is now named ‘" + currentName + "’, not ‘" + params.trackName + "’. Refresh first.");
   }
   return track;
}

function selectTrack(request, params, callback) {
   var track = requireTrack(params);
   var index = Number(params.trackIndex);
   var expectedName = track.name().get();
   track.selectInMixer();
   later(140, function() {
      try {
         // Ask Bitwig whether the cursor now is this track. Comparing positions
         // fails for tracks inside a group: the cursor reports its position
         // within the group, the main track bank its position in the whole list.
         if (cursorTrack.name().get() !== expectedName || !trackIsCursor[index].get()) {
            throw new Error("Bitwig did not select the requested track. No device operation was performed.");
         }
         callback(track);
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function deviceSnapshot(device, index) {
   return {
      index: index,
      name: device.name().get(),
      type: device.deviceType().get(),
      position: device.position().get(),
      nested: device.isNested().get(),
      plugin: device.isPlugin().get(),
      enabled: device.isEnabled().get(),
      windowOpen: device.isWindowOpen().get(),
      presetName: device.presetName().get(),
      sampleName: device.sampleName().get()
   };
}

function listDevicesNow() {
   var total = deviceBank.itemCount().get();
   var count = Math.min(total, MAX_DEVICES);
   var devices = [];
   for (var i = 0; i < count; i++) {
      var device = deviceBank.getItemAt(i);
      if (device.exists().get()) devices.push(deviceSnapshot(device, i));
   }
   return { total: total, returned: devices.length, truncated: total > MAX_DEVICES, devices: devices };
}

function listNestedDevicesNow() {
   var total = nestedDeviceBank.itemCount().get();
   var count = Math.min(total, MAX_DEVICES);
   var devices = [];
   for (var i = 0; i < count; i++) {
      var device = nestedDeviceBank.getItemAt(i);
      if (device.exists().get()) devices.push(deviceSnapshot(device, i));
   }
   return { total: total, returned: devices.length, truncated: total > MAX_DEVICES, devices: devices };
}

function requireDevice(params) {
   var index = Number(params.deviceIndex);
   if (index < 0 || index >= MAX_DEVICES || index >= deviceBank.itemCount().get()) {
      throw new Error("Device index " + index + " is not available. Refresh with bitwig_devices.");
   }
   var device = deviceBank.getItemAt(index);
   if (!device.exists().get()) throw new Error("Device " + index + " no longer exists.");
   var currentName = device.name().get();
   if (currentName !== String(params.deviceName)) {
      throw new Error("Safety check failed: device " + index + " is now ‘" + currentName + "’, not ‘" + params.deviceName + "’. Refresh first.");
   }
   return device;
}

function selectDevice(request, params, callback) {
   selectTrack(request, params, function() {
      try {
         var device = requireDevice(params);
         var expectedName = device.name().get();
         var expectedPosition = device.position().get();
         cursorDevice.selectDevice(device);

         var attempts = 0;
         function verifySelection() {
            try {
               attempts++;
               var selected = cursorDevice.exists().get() &&
                  cursorDevice.name().get() === expectedName &&
                  cursorDevice.position().get() === expectedPosition;
               if (!selected && attempts < 12) {
                  later(80, verifySelection);
                  return;
               }
               if (!selected) {
                  throw new Error("Bitwig did not select device " + expectedPosition + " ‘" + expectedName + "’. No parameter was changed.");
               }
               // The direct-parameter observer follows the cursor device. Give
               // it one additional update cycle before any read or write.
               later(100, function() {
                  try {
                     callback(device);
                  } catch (error) {
                     finish(request, false, { message: String(error.message || error) });
                  }
               });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         }
         later(80, verifySelection);
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function parameterSnapshot(id) {
   return {
      id: id,
      name: directNames[id] || id,
      normalizedValue: directValues[id] === undefined ? null : directValues[id],
      displayValue: directDisplays[id] || ""
   };
}

function remoteControlsSnapshot() {
   var pageNames = arrayCopy(cursorRemoteControlsPage.pageNames().get());
   var selectedPageIndex = cursorRemoteControlsPage.selectedPageIndex().get();
   var controls = [];
   for (var i = 0; i < 8; i++) {
      var control = cursorRemoteControlsPage.getParameter(i);
      controls.push({
         index: i,
         exists: control.exists().get(),
         name: control.name().get(),
         normalizedValue: control.get(),
         displayValue: control.displayedValue().get()
      });
   }
   return {
      remoteControlsVisible: cursorDevice.isRemoteControlsSectionVisible().get(),
      parameterListVisible: cursorDevice.isParameterPageSectionVisible().get(),
      pageCount: cursorRemoteControlsPage.pageCount().get(),
      pageNames: pageNames,
      selectedPageIndex: selectedPageIndex,
      selectedPageName: selectedPageIndex >= 0 && selectedPageIndex < pageNames.length ? pageNames[selectedPageIndex] : "",
      controls: controls
   };
}

function encodeReply(id, ok, payload) {
   return encodeUtf8(JSON.stringify({
      protocol: CONTROL_DECK_PROTOCOL,
      id: String(id),
      ok: Boolean(ok),
      payload: payload || {}
   }));
}

// A reply has to fit in one datagram. An oversized reply is replaced by a short
// error the client can show, and a failed send is logged as an error and
// reported to the client with a short error reply when that still gets through.
function respond(replyPort, id, ok, payload, method) {
   var what = method ? "the " + method + " reply" : "the reply";
   var bytes = encodeReply(id, ok, payload);
   if (bytes.length > MAX_REPLY_BYTES) {
      host.errorln("Control Deck: " + what + " is " + bytes.length + " bytes, over the " + MAX_REPLY_BYTES + "-byte limit.");
      bytes = encodeReply(id, false, {
         message: "Bitwig's answer is " + bytes.length + " bytes, over the " + MAX_REPLY_BYTES + "-byte limit for one reply. Ask for less, for example with a smaller limit, an offset or a query.",
         replyBytes: bytes.length,
         maxReplyBytes: MAX_REPLY_BYTES
      });
   }
   try {
      host.sendDatagramPacket("127.0.0.1", Number(replyPort), bytes);
   } catch (error) {
      host.errorln("Control Deck could not send " + what + " (" + bytes.length + " bytes): " + error);
      try {
         host.sendDatagramPacket("127.0.0.1", Number(replyPort), encodeReply(id, false, {
            message: "Bitwig could not send " + what + " (" + bytes.length + " bytes): " + String(error.message || error),
            replyBytes: bytes.length
         }));
      } catch (secondError) {
         host.errorln("Control Deck could not send the error reply either: " + secondError);
      }
   }
}

// Each request is answered exactly once. Late steps of a request that already
// failed or timed out are ignored, so they can't release the next request early.
function finish(request, ok, payload) {
   if (request.done) return;
   if (request.cleanup) {
      try {
         request.cleanup();
      } catch (error) {
         host.errorln("Control Deck cleanup error: " + error);
      }
   }
   request.done = true;
   respond(request.source, request.id, ok, payload, request.method);
   if (currentRequest === request) {
      currentRequest = null;
      requestBusy = false;
      later(1, processNextRequest);
   }
}

function processNextRequest() {
   if (requestBusy) return;
   var now = Date.now();
   // The client stops waiting at its deadline, so don't start work nobody is waiting for.
   while (requestQueue.length && requestQueue[0].deadline < now) requestQueue.shift();
   if (requestQueue.length === 0) return;
   requestBusy = true;
   var request = requestQueue.shift();
   currentRequest = request;
   host.scheduleTask(function() {
      if (!request.done) {
         finish(request, false, {
            message: "Bitwig did not finish " + request.method + " within " + request.limitMs + " ms. The bridge has recovered and is ready for the next request."
         });
      }
   }, request.limitMs);
   try {
      dispatch(request);
   } catch (error) {
      finish(request, false, { message: String(error.message || error) });
   }
}

function enqueue(source, id, method, params, timeoutMs) {
   if (requestQueue.length >= 32) {
      respond(source, id, false, { message: "Control Deck Bridge is busy. Try the request again." });
      return;
   }
   var clientTimeout = Number(timeoutMs);
   var hasTimeout = isFinite(clientTimeout) && clientTimeout > 0;
   requestQueue.push({
      source: source,
      id: id,
      method: method,
      params: params || {},
      deadline: hasTimeout ? Date.now() + clientTimeout : Infinity,
      limitMs: hasTimeout ? Math.max(1000, clientTimeout + 1000) : DEFAULT_REQUEST_LIMIT_MS
   });
   processNextRequest();
}

function readFilterOptions(bank) {
   var options = [];
   var count = Math.min(bank.itemCount().get(), bank.getSizeOfBank());
   for (var i = 0; i < count; i++) {
      var item = bank.getItemAt(i);
      if (item.exists().get()) options.push(item.name().get());
   }
   return options;
}

function resetBrowserFilters() {
   popupBrowser.smartCollectionColumn().getWildcardItem().isSelected().set(true);
   popupBrowser.locationColumn().getWildcardItem().isSelected().set(true);
   popupBrowser.deviceColumn().getWildcardItem().isSelected().set(true);
   popupBrowser.deviceTypeColumn().getWildcardItem().isSelected().set(true);
   popupBrowser.categoryColumn().getWildcardItem().isSelected().set(true);
   popupBrowser.tagColumn().getWildcardItem().isSelected().set(true);
   popupBrowser.fileTypeColumn().getWildcardItem().isSelected().set(true);
   popupBrowser.creatorColumn().getWildcardItem().isSelected().set(true);
   deviceTypeBank.scrollPosition().set(0);
   categoryBank.scrollPosition().set(0);
   tagBank.scrollPosition().set(0);
   fileTypeBank.scrollPosition().set(0);
   creatorBank.scrollPosition().set(0);
   resultBank.scrollPosition().set(0);
}

function selectFilterValue(request, label, bank, value, callback) {
   if (!value) {
      callback();
      return;
   }
   bank.scrollPosition().set(0);
   later(90, function() {
      try {
         var wanted = normalizeText(value);
         var count = Math.min(bank.itemCount().get(), bank.getSizeOfBank());
         var match = null;
         for (var i = 0; i < count; i++) {
            var item = bank.getItemAt(i);
            if (item.exists().get() && normalizeText(item.name().get()) === wanted) match = item;
         }
         if (!match) {
            throw new Error("No exact " + label + " filter named ‘" + value + "’. Available: " + readFilterOptions(bank).join(", "));
         }
         match.isSelected().set(true);
         later(180, callback);
      } catch (error) {
         popupBrowser.cancel();
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function prepareBrowser(request, params, callback) {
   cursorTrack.endOfDeviceChainInsertionPoint().browse();
   later(280, function() {
      try {
         if (!popupBrowser.exists().get()) throw new Error("Bitwig did not open its insertion browser.");
         var contentTypes = arrayCopy(popupBrowser.contentTypeNames().get());
         var contentType = String(params.contentType || "Devices");
         var contentTypeIndex = contentTypes.indexOf(contentType);
         if (contentTypeIndex < 0) throw new Error("Bitwig browser content type ‘" + contentType + "’ is unavailable. Available: " + contentTypes.join(", "));
         popupBrowser.selectedContentTypeIndex().set(contentTypeIndex);
         later(180, function() {
            if (contentType === "Devices") {
               resetBrowserFilters();
               later(1000, function() {
                  selectFilterValue(request, "device type", deviceTypeBank, params.deviceType, function() {
                     selectFilterValue(request, "category", categoryBank, params.category, function() {
                        selectFilterValue(request, "tag", tagBank, params.tag, function() {
                           selectFilterValue(request, "file type", fileTypeBank, params.fileType, function() {
                              selectFilterValue(request, "creator", creatorBank, params.creator, callback);
                           });
                        });
                     });
                  });
               });
            } else {
               resultBank.scrollPosition().set(0);
               later(180, callback);
            }
         });
      } catch (error) {
         popupBrowser.cancel();
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function scanBrowserResults(request, query, exact, limit, callback) {
   var wanted = normalizeText(query);
   var total = Math.min(resultColumn.entryCount().get(), MAX_BROWSER_RESULTS);
   var matches = [];
   var offset = 0;

   function scanPage() {
      resultBank.scrollPosition().set(offset);
      later(100, function() {
         try {
            var pageCount = Math.min(BROWSER_PAGE, Math.max(0, total - offset));
            for (var i = 0; i < pageCount; i++) {
               var item = resultBank.getItemAt(i);
               if (!item.exists().get()) continue;
               var name = item.name().get();
               var comparable = normalizeText(name);
               var hit = exact ? comparable === wanted : comparable.indexOf(wanted) !== -1;
               if (hit) matches.push({ resultIndex: offset + i, name: name });
            }
            offset += BROWSER_PAGE;
            if (offset < total && (exact || matches.length < limit)) scanPage();
            else callback(matches, resultColumn.entryCount().get());
         } catch (error) {
            popupBrowser.cancel();
            finish(request, false, { message: String(error.message || error) });
         }
      });
   }

   scanPage();
}

function countDeviceName(name) {
   var wanted = normalizeText(name);
   var count = 0;
   var total = Math.min(deviceBank.itemCount().get(), MAX_DEVICES);
   for (var i = 0; i < total; i++) {
      var item = deviceBank.getItemAt(i);
      if (item.exists().get() && normalizeText(item.name().get()) === wanted) count++;
   }
   return count;
}

function handleFindDevices(request) {
   var params = request.params;
   selectTrack(request, params, function() {
      prepareBrowser(request, params, function() {
         scanBrowserResults(request, params.query, false, Number(params.limit || 50), function(matches, total) {
            popupBrowser.cancel();
            finish(request, true, {
               session: "Devices",
               presetSearch: false,
               totalDevicesAfterFilters: total,
               returned: Math.min(matches.length, Number(params.limit || 50)),
               matches: matches.slice(0, Number(params.limit || 50))
            });
         });
      });
   });
}

function handleFindSamples(request) {
   var params = request.params;
   params.contentType = "Samples";
   selectTrack(request, params, function() {
      prepareBrowser(request, params, function() {
         scanBrowserResults(request, params.query, false, Number(params.limit || 50), function(matches, total) {
            popupBrowser.cancel();
            finish(request, true, {
               session: "Samples",
               totalSamplesAfterFilters: total,
               returned: Math.min(matches.length, Number(params.limit || 50)),
               matches: matches.slice(0, Number(params.limit || 50))
            });
         });
      });
   });
}

function handleInsertSample(request) {
   var params = request.params;
   params.contentType = "Samples";
   selectTrack(request, params, function() {
      var beforeCount = deviceBank.itemCount().get();
      prepareBrowser(request, params, function() {
         scanBrowserResults(request, params.exactName, true, 20, function(matches) {
            if (matches.length === 0) {
               popupBrowser.cancel();
               finish(request, false, { message: "No indexed sample named exactly ‘" + params.exactName + "’ was found in Bitwig's Samples browser." });
               return;
            }
            if (matches.length !== 1) {
               popupBrowser.cancel();
               finish(request, false, {
                  message: "Sample insertion refused because ‘" + params.exactName + "’ has " + matches.length + " exact matches.",
                  matches: matches
               });
               return;
            }

            var resultIndex = matches[0].resultIndex;
            var pageOffset = Math.floor(resultIndex / BROWSER_PAGE) * BROWSER_PAGE;
            var indexInPage = resultIndex - pageOffset;
            resultBank.scrollPosition().set(pageOffset);
            later(110, function() {
               try {
                  var item = resultBank.getItemAt(indexInPage);
                  if (!item.exists().get() || normalizeText(item.name().get()) !== normalizeText(params.exactName)) {
                     throw new Error("The Samples browser results changed before insertion. Nothing was loaded; try again.");
                  }
                  item.isSelected().set(true);
                  later(80, function() {
                     popupBrowser.commit();
                     later(1000, function() {
                        var afterCount = deviceBank.itemCount().get();
                        if (afterCount <= beforeCount) {
                           finish(request, false, { message: "Bitwig did not confirm a sampler device after loading the sample." });
                           return;
                        }
                        var devices = listDevicesNow();
                        var inserted = devices.devices[devices.devices.length - 1];
                        finish(request, true, {
                           insertedSample: params.exactName,
                           session: "Samples",
                           verifiedByDeviceChainReadback: true,
                           sampler: inserted,
                           devices: devices.devices
                        });
                     });
                  });
               } catch (error) {
                  popupBrowser.cancel();
                  finish(request, false, { message: String(error.message || error) });
               }
            });
         });
      });
   });
}

function handleInsertSampleFile(request) {
   var params = request.params;
   var path = String(params.path || "");
   if (path.charAt(0) !== "/" || !/\.(wav|aif|aiff|flac)$/i.test(path)) {
      throw new Error("Sample path must be an absolute WAV, AIFF, or FLAC file path.");
   }
   selectTrack(request, params, function() {
      var beforeCount = deviceBank.itemCount().get();
      cursorTrack.endOfDeviceChainInsertionPoint().insertFile(path);
      later(1200, function() {
         try {
            var afterCount = deviceBank.itemCount().get();
            if (afterCount <= beforeCount) throw new Error("Bitwig did not create a sampler device from ‘" + path + "’. Nothing was inserted.");
            var devices = listDevicesNow();
            var inserted = devices.devices[devices.devices.length - 1];
            if (!inserted || !inserted.sampleName) throw new Error("Bitwig created a device but did not confirm its loaded sample name.");
            finish(request, true, {
               insertedFile: path,
               verifiedByDeviceChainReadback: true,
               sampler: inserted,
               devices: devices.devices
            });
         } catch (error) {
            finish(request, false, { message: String(error.message || error) });
         }
      });
   });
}

function handleInsertDevice(request) {
   var params = request.params;
   selectTrack(request, params, function() {
      var beforeCount = deviceBank.itemCount().get();
      var beforeOccurrences = countDeviceName(params.exactName);
      prepareBrowser(request, params, function() {
         scanBrowserResults(request, params.exactName, true, 20, function(matches) {
            if (matches.length === 0) {
               popupBrowser.cancel();
               finish(request, false, { message: "No device named exactly ‘" + params.exactName + "’ was found in Bitwig's Devices browser." });
               return;
            }
            if (matches.length !== 1) {
               popupBrowser.cancel();
               finish(request, false, {
                  message: "Insertion refused because ‘" + params.exactName + "’ has " + matches.length + " exact device matches. Supply deviceType to disambiguate.",
                  matches: matches
               });
               return;
            }

            var resultIndex = matches[0].resultIndex;
            var pageOffset = Math.floor(resultIndex / BROWSER_PAGE) * BROWSER_PAGE;
            var indexInPage = resultIndex - pageOffset;
            resultBank.scrollPosition().set(pageOffset);
            later(110, function() {
               try {
                  var item = resultBank.getItemAt(indexInPage);
                  if (!item.exists().get() || normalizeText(item.name().get()) !== normalizeText(params.exactName)) {
                     throw new Error("The Browser results changed before insertion. Nothing was loaded; try again.");
                  }
                  item.isSelected().set(true);
                  later(80, function() {
                     popupBrowser.commit();
                     later(700, function() {
                        var afterCount = deviceBank.itemCount().get();
                        var afterOccurrences = countDeviceName(params.exactName);
                        if (afterCount <= beforeCount || afterOccurrences <= beforeOccurrences) {
                           finish(request, false, { message: "Bitwig did not confirm the new device in the chain. Refresh the device list before continuing." });
                           return;
                        }
                        var devices = listDevicesNow();
                        finish(request, true, {
                           inserted: params.exactName,
                           session: "Devices",
                           presetLoaded: false,
                           verifiedByDeviceChainReadback: true,
                           devices: devices.devices
                        });
                     });
                  });
               } catch (error) {
                  popupBrowser.cancel();
                  finish(request, false, { message: String(error.message || error) });
               }
            });
         });
      });
   });
}

function handleInsertClapDevice(request) {
   var params = request.params;
   var clapId = String(params.clapId || "").trim();
   if (!clapId) throw new Error("A CLAP plug-in ID is required.");
   var hasBeforeIndex = params.beforeDeviceIndex !== undefined && params.beforeDeviceIndex !== null;
   var hasBeforeName = params.beforeDeviceName !== undefined && params.beforeDeviceName !== null;
   if (hasBeforeIndex !== hasBeforeName) {
      throw new Error("beforeDeviceIndex and beforeDeviceName must be supplied together.");
   }

   selectTrack(request, params, function() {
      try {
         var beforeCount = deviceBank.itemCount().get();
         var insertionPoint = cursorTrack.endOfDeviceChainInsertionPoint();
         var insertedIndex = beforeCount;
         var target = null;
         if (hasBeforeIndex) {
            target = requireDevice({
               deviceIndex: params.beforeDeviceIndex,
               deviceName: params.beforeDeviceName
            });
            insertedIndex = Number(params.beforeDeviceIndex);
            insertionPoint = target.beforeDeviceInsertionPoint();
         }
         insertionPoint.insertCLAPDevice(clapId);
         later(1200, function() {
            try {
            var afterCount = deviceBank.itemCount().get();
            if (afterCount <= beforeCount) {
               throw new Error("Bitwig did not insert the CLAP device ‘" + clapId + "’. The plug-in may not be available to the current engine.");
            }
            var devices = listDevicesNow();
            finish(request, true, {
               insertedClapId: clapId,
               insertedBefore: target ? {
                  index: Number(params.beforeDeviceIndex),
                  name: String(params.beforeDeviceName)
               } : null,
               browserBypassed: true,
               verifiedByDeviceChainReadback: true,
               device: devices.devices[insertedIndex] || null,
               devices: devices.devices
            });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function handleInsertBitwigDevice(request) {
   var params = request.params;
   var bitwigId = String(params.bitwigId || "").trim();
   if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bitwigId)) {
      throw new Error("A valid Bitwig device UUID is required.");
   }

   var hasBeforeIndex = params.beforeDeviceIndex !== undefined && params.beforeDeviceIndex !== null;
   var hasBeforeName = params.beforeDeviceName !== undefined && params.beforeDeviceName !== null;
   if (hasBeforeIndex !== hasBeforeName) {
      throw new Error("beforeDeviceIndex and beforeDeviceName must be supplied together.");
   }

   selectTrack(request, params, function() {
      try {
         var beforeCount = deviceBank.itemCount().get();
         var insertionPoint;
         var target = null;
         var insertedIndex = beforeCount;

         if (hasBeforeIndex) {
            target = requireDevice({
               deviceIndex: params.beforeDeviceIndex,
               deviceName: params.beforeDeviceName
            });
            insertedIndex = Number(params.beforeDeviceIndex);
            insertionPoint = target.beforeDeviceInsertionPoint();
         } else {
            insertionPoint = cursorTrack.endOfDeviceChainInsertionPoint();
         }

         insertionPoint.insertBitwigDevice(java.util.UUID.fromString(bitwigId));
         later(850, function() {
            try {
               var afterCount = deviceBank.itemCount().get();
               if (afterCount <= beforeCount) {
                  throw new Error("Bitwig did not insert stock device ‘" + bitwigId + "’ at the requested position.");
               }
               var devices = listDevicesNow();
               finish(request, true, {
                  insertedBitwigId: bitwigId,
                  insertedBefore: target ? {
                     index: Number(params.beforeDeviceIndex),
                     name: String(params.beforeDeviceName)
                  } : null,
                  verifiedByDeviceChainReadback: true,
                  device: devices.devices[insertedIndex] || null,
                  devices: devices.devices
               });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function handleNestDevice(request) {
   var params = request.params;
   selectTrack(request, params, function() {
      try {
         var parent = requireDevice({
            deviceIndex: params.parentDeviceIndex,
            deviceName: params.parentDeviceName
         });
         var child = requireDevice({
            deviceIndex: params.childDeviceIndex,
            deviceName: params.childDeviceName
         });
         if (Number(params.parentDeviceIndex) === Number(params.childDeviceIndex)) {
            throw new Error("A device cannot be nested inside itself.");
         }
         var beforeCount = deviceBank.itemCount().get();
         cursorDevice.selectDevice(parent);
         later(180, function() {
            try {
               var slotNames = arrayCopy(cursorDevice.slotNames().get());
               var requestedSlot = String(params.slotName || "Post FX");
               if (slotNames.indexOf(requestedSlot) === -1) {
                  throw new Error("Device ‘" + params.parentDeviceName + "’ does not expose the ‘" + requestedSlot + "’ slot. Available slots: " + slotNames.join(", "));
               }
               cursorDeviceSlot.selectInEditor();
               later(140, function() {
                  var currentSlot = cursorDeviceSlot.name().get();
                  if (currentSlot && currentSlot !== requestedSlot) {
                     finish(request, false, { message: "Bitwig selected slot ‘" + currentSlot + "’ instead of ‘" + requestedSlot + "’." });
                     return;
                  }
                  cursorDeviceSlot.endOfDeviceChainInsertionPoint().moveDevices(child);
                  later(850, function() {
                  try {
                     var topLevel = listDevicesNow();
                     var nested = listNestedDevicesNow();
                     if (topLevel.total !== beforeCount - 1) {
                        throw new Error("Bitwig did not move ‘" + params.childDeviceName + "’ into the parent device. The top-level chain was left unchanged.");
                     }
                     var nestedBankVerified = nested.total >= 1 && nested.devices[0].name === String(params.childDeviceName);
                     var cursorVerified = cursorDevice.exists().get() &&
                        cursorDevice.name().get() === String(params.childDeviceName) &&
                        cursorDevice.isNested().get();
                     if (!nestedBankVerified && !cursorVerified) {
                        throw new Error("Bitwig changed the chain but did not verify ‘" + params.childDeviceName + "’ inside ‘" + params.parentDeviceName + "’. Refresh before saving.");
                     }
                     parent.selectInEditor();
                     finish(request, true, {
                        nestedDevice: String(params.childDeviceName),
                        parentDevice: String(params.parentDeviceName),
                        slotName: requestedSlot,
                        topLevel: topLevel,
                        nested: nested,
                        verifiedByDeviceChainReadback: nestedBankVerified,
                        verifiedByNestedCursorReadback: cursorVerified
                     });
                  } catch (error) {
                     finish(request, false, { message: String(error.message || error) });
                  }
                  });
               });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function handleSaveDevicePreset(request) {
   var params = request.params;
   selectDevice(request, params, function(device) {
      try {
         var presetName = String(params.presetName || "").trim();
         device.selectInEditor();
         later(180, function() {
            try {
               saveToLibraryAction.invoke();
               later(700, function() {
                  if (params.confirm !== false) application.enter();
                  later(450, function() {
                     finish(request, true, {
                        device: deviceSnapshot(device, Number(params.deviceIndex)),
                        requestedPresetName: presetName,
                        saveToLibraryOpened: true,
                        confirmationSent: params.confirm !== false,
                        nameEntryRequired: params.confirm === false && !!presetName,
                        suggestedPresetName: presetName || null
                     });
                  });
               });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

// Re-reads Bitwig until check() reports no mismatch (returns "") or about a
// second passes, then fails the request with what Bitwig actually holds.
function verifyReadback(request, check, onVerified, attempt) {
   attempt = attempt || 1;
   later(100, function() {
      var mismatch = check();
      if (!mismatch) {
         onVerified();
      } else if (attempt >= 10) {
         finish(request, false, { message: "Bitwig did not confirm the change: " + mismatch });
      } else {
         verifyReadback(request, check, onVerified, attempt + 1);
      }
   });
}

function differs(actual, requested, tolerance) {
   return !(Math.abs(Number(actual) - Number(requested)) <= tolerance);
}

function handleTransport(request) {
   var params = request.params;
   var action = String(params.action || "status");
   if (action === "play") transport.play();
   else if (action === "stop") transport.stop();
   else if (action === "toggle") transport.togglePlay();
   else if (action === "set_tempo") {
      var tempo = Number(params.tempo);
      if (!(tempo >= 20 && tempo <= 666)) throw new Error("Tempo must be between 20 and 666 BPM.");
      transport.tempo().value().setRaw(tempo);
      verifyReadback(request, function() {
         var actual = transport.tempo().value().getRaw();
         return differs(actual, tempo, 0.01) ? "tempo is " + actual + " BPM, requested " + tempo + " BPM." : "";
      }, function() {
         finish(request, true, readTransport());
      });
      return;
   } else if (action === "set_position") {
      var position = Number(params.positionBeats);
      if (!(position >= 0)) throw new Error("Position must be zero or greater.");
      transport.setPosition(position);
   } else if (action !== "status") throw new Error("Unknown transport action: " + action);

   later(action === "status" ? 1 : 100, function() {
      finish(request, true, readTransport());
   });
}

function handleCueMarkers(request) {
   var params = request.params;
   var action = String(params.action || "list");
   if (action === "list") {
      finish(request, true, listCueMarkers());
      return;
   }
   if (action !== "upsert") throw new Error("Cue marker action must be list or upsert.");

   var specifications = params.markers || [];
   if (!specifications.length) throw new Error("At least one cue marker is required.");
   if (specifications.length > 64) throw new Error("A maximum of 64 cue markers can be created at once.");

   var normalized = [];
   var seenPositions = {};
   for (var specificationIndex = 0; specificationIndex < specifications.length; specificationIndex++) {
      var requested = specifications[specificationIndex];
      var markerName = String(requested.name || "").trim();
      var markerPosition = Number(requested.positionBeats);
      if (!markerName) throw new Error("Cue marker names must not be empty.");
      if (!(markerPosition >= 0)) throw new Error("Cue marker positions must be zero or greater.");
      var positionKey = markerPosition.toFixed(6);
      if (seenPositions[positionKey]) throw new Error("Cue marker positions must be unique within one request.");
      seenPositions[positionKey] = true;
      normalized.push({ name: markerName, positionBeats: markerPosition });
   }

   var created = 0;
   var updated = 0;
   var current = 0;
   var originalTransportPosition = transport.getPosition().get();
   var movedPlayhead = false;
   // A new marker at the playhead itself goes last, so it cannot sit under the
   // playhead while the other new markers are added.
   normalized.sort(function(left, right) {
      return Number(Math.abs(left.positionBeats - originalTransportPosition) < 0.0001) -
         Number(Math.abs(right.positionBeats - originalTransportPosition) < 0.0001);
   });
   var temporaryPosition = 64;
   var existingMarkers = listCueMarkers().markers;
   for (var existingIndex = 0; existingIndex < existingMarkers.length; existingIndex++) {
      temporaryPosition = Math.max(temporaryPosition, existingMarkers[existingIndex].positionBeats + 64);
   }
   for (var requestedIndex = 0; requestedIndex < normalized.length; requestedIndex++) {
      temporaryPosition = Math.max(temporaryPosition, normalized[requestedIndex].positionBeats + 64);
   }

   // Bitwig 18 can only add a cue marker at the play position, so new markers
   // are added where the playhead already is and then moved into place. The
   // playhead is moved only when the transport is stopped and a marker already
   // sits under it, and it is put back before the reply.
   function restorePlayhead() {
      if (movedPlayhead) transport.setPosition(originalTransportPosition);
   }

   function fail(error) {
      restorePlayhead();
      finish(request, false, { message: String(error.message || error), cueMarkers: listCueMarkers() });
   }

   function verifyAndFinish() {
      restorePlayhead();
      later(movedPlayhead ? 220 : 120, function() {
         try {
            var verified = [];
            var missing = [];
            for (var verifyIndex = 0; verifyIndex < normalized.length; verifyIndex++) {
               var expected = normalized[verifyIndex];
               var match = cueMarkerAtPosition(expected.positionBeats);
               if (match && match.marker.name().get() === expected.name) {
                  verified.push(cueMarkerSnapshot(match.marker, match.index));
               } else {
                  missing.push(expected);
               }
            }
            if (missing.length) {
               finish(request, false, {
                  message: "Bitwig did not verify every requested cue marker.",
                  missing: missing,
                  cueMarkers: listCueMarkers()
               });
               return;
            }
            finish(request, true, {
               created: created,
               updated: updated,
               verified: verified.length,
               markers: verified,
               cueMarkers: listCueMarkers()
            });
         } catch (error) {
            finish(request, false, { message: String(error.message || error) });
         }
      });
   }

   function addAndPlace(expected) {
      var beforeCounts = cueMarkerFingerprintCounts();
      var beforeTotal = cueMarkerBank.itemCount().get();
      transport.addCueMarkerAtPlaybackPosition();
      var identifyAttempt = 0;

      function identifyInsertedMarker() {
         try {
            var afterTotal = cueMarkerBank.itemCount().get();
            if (afterTotal <= beforeTotal) {
               if (identifyAttempt++ < 20) {
                  later(100, identifyInsertedMarker);
                  return;
               }
               throw new Error("Bitwig did not create a new cue marker at the play position.");
            }

            var afterSeen = {};
            var inserted = null;
            var count = Math.min(afterTotal, MAX_CUE_MARKERS);
            for (var markerIndex = 0; markerIndex < count; markerIndex++) {
               var marker = cueMarkerBank.getItemAt(markerIndex);
               if (!marker.exists().get()) continue;
               var fingerprint = JSON.stringify([marker.name().get(), marker.position().get()]);
               afterSeen[fingerprint] = Number(afterSeen[fingerprint] || 0) + 1;
               if (!inserted && afterSeen[fingerprint] > Number(beforeCounts[fingerprint] || 0)) {
                  inserted = marker;
               }
            }
            if (!inserted) throw new Error("Bitwig created a cue marker but the bridge could not identify it.");

            inserted.name().set(expected.name);
            inserted.position().setRaw(expected.positionBeats);
            created++;
            later(240, processNext);
         } catch (error) {
            fail(error);
         }
      }
      later(100, identifyInsertedMarker);
   }

   function addAtTemporaryPosition(expected) {
      var insertionPosition = temporaryPosition;
      temporaryPosition += 4;
      movedPlayhead = true;
      transport.setPosition(insertionPosition);
      var positionAttempt = 0;

      function waitForInsertionPosition() {
         try {
            if (Math.abs(transport.getPosition().get() - insertionPosition) >= 0.0001) {
               if (positionAttempt++ < 20) {
                  later(100, waitForInsertionPosition);
                  return;
               }
               throw new Error("Bitwig did not verify the temporary cue-marker insertion position.");
            }
            addAndPlace(expected);
         } catch (error) {
            fail(error);
         }
      }
      later(100, waitForInsertionPosition);
   }

   function processNext() {
      try {
         if (current >= normalized.length) {
            verifyAndFinish();
            return;
         }

         var expected = normalized[current++];
         var existing = cueMarkerAtPosition(expected.positionBeats);
         if (existing) {
            existing.marker.name().set(expected.name);
            existing.marker.position().setRaw(expected.positionBeats);
            updated++;
            later(160, processNext);
            return;
         }

         if (!transport.isPlaying().get() && cueMarkerAtPosition(transport.getPosition().get())) {
            addAtTemporaryPosition(expected);
            return;
         }
         addAndPlace(expected);
      } catch (error) {
         fail(error);
      }
   }

   arranger.areCueMarkersVisible().set(true);
   later(180, processNext);
}

function handleCreateTrack(request) {
   var params = request.params;
   var before = trackBank.itemCount().get();
   if (params.kind === "instrument") application.createInstrumentTrack(-1);
   else if (params.kind === "audio") application.createAudioTrack(-1);
   else if (params.kind === "effect") application.createEffectTrack(-1);
   else throw new Error("Track kind must be instrument, audio, or effect.");

   later(350, function() {
      try {
         var after = trackBank.itemCount().get();
         if (after <= before || before >= MAX_TRACKS) {
            throw new Error("Bitwig did not expose the new track in the main track list.");
         }
         var track = trackBank.getItemAt(before);
         track.setName(String(params.name));
         track.selectInMixer();
         later(140, function() {
            finish(request, true, { created: trackSnapshot(track, before), emptyDeviceChain: true, presetLoaded: false });
         });
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function markSlot(slot) {
   interested(slot.exists());
   interested(slot.name());
   interested(slot.hasContent());
   interested(slot.isSelected());
   interested(slot.isPlaying());
}

function clipSnapshot(slot, slotIndex) {
   return {
      slotIndex: slotIndex,
      exists: slot.exists().get(),
      name: slot.name().get(),
      hasContent: slot.hasContent().get(),
      selected: slot.isSelected().get(),
      playing: slot.isPlaying().get()
   };
}

function handleSetTrackMix(request) {
   var params = request.params;
   var track = requireTrack(params);
   if (params.volumeNormalized !== undefined) {
      var volume = Number(params.volumeNormalized);
      if (!(volume >= 0 && volume <= 1)) throw new Error("Track volume must be between 0 and 1.");
      track.volume().setImmediately(volume);
   }
   if (params.panNormalized !== undefined) {
      var pan = Number(params.panNormalized);
      if (!(pan >= 0 && pan <= 1)) throw new Error("Track pan must be between 0 and 1.");
      track.pan().setImmediately(pan);
   }
   if (params.mute !== undefined) track.mute().set(Boolean(params.mute));
   if (params.solo !== undefined) track.solo().set(Boolean(params.solo));
   if (params.arm !== undefined) track.arm().set(Boolean(params.arm));
   verifyReadback(request, function() {
      var problems = [];
      if (params.volumeNormalized !== undefined && differs(track.volume().get(), params.volumeNormalized, 0.002)) {
         problems.push("volume is " + track.volume().get() + ", requested " + params.volumeNormalized);
      }
      if (params.panNormalized !== undefined && differs(track.pan().get(), params.panNormalized, 0.002)) {
         problems.push("pan is " + track.pan().get() + ", requested " + params.panNormalized);
      }
      // Bitwig's script host only supports direct method calls on these values
      // (track.mute()), not computed ones (track["mute"]()).
      var switches = [
         { name: "mute", actual: track.mute().get() },
         { name: "solo", actual: track.solo().get() },
         { name: "arm", actual: track.arm().get() }
      ];
      for (var i = 0; i < switches.length; i++) {
         var requested = params[switches[i].name];
         if (requested !== undefined && switches[i].actual !== Boolean(requested)) {
            problems.push(switches[i].name + " is " + switches[i].actual + ", requested " + Boolean(requested));
         }
      }
      return problems.join("; ");
   }, function() {
      finish(request, true, { track: trackSnapshot(track, Number(params.trackIndex)) });
   });
}

function handleRenameTrack(request) {
   var params = request.params;
   var track = requireTrack(params);
   var oldName = track.name().get();
   var newName = String(params.newName || "").trim();
   if (!newName || newName.length > 120) throw new Error("New track name must contain 1 to 120 characters.");
   track.setName(newName);
   later(120, function() {
      try {
         if (track.name().get() !== newName) throw new Error("Bitwig did not confirm the new track name.");
         finish(request, true, {
            renamed: { oldName: oldName, newName: newName },
            track: trackSnapshot(track, Number(params.trackIndex))
         });
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function validateClipNotes(notes, stepSize, lengthBeats) {
   if (!Array.isArray(notes)) throw new Error("Clip notes must be an array.");
   if (notes.length > 4096) throw new Error("A Control Deck clip can contain at most 4096 notes.");
   var pages = {};
   var noteCount = 0;
   for (var i = 0; i < notes.length; i++) {
      var note = notes[i] || {};
      var beat = Number(note.beat);
      var pitch = Number(note.pitch);
      var velocity = Number(note.velocity === undefined ? 100 : note.velocity);
      var duration = Number(note.duration === undefined ? stepSize : note.duration);
      var channel = Number(note.channel === undefined ? 0 : note.channel);
      var absoluteStep = Math.round(beat / stepSize);
      if (!(beat >= 0 && beat < lengthBeats) || Math.abs((absoluteStep * stepSize) - beat) > 0.0001) {
         throw new Error("Note " + i + " must start on the clip step grid and before the clip end.");
      }
      if (!(pitch >= 0 && pitch <= 127) || Math.floor(pitch) !== pitch) throw new Error("Note " + i + " has an invalid MIDI pitch.");
      if (!(velocity >= 1 && velocity <= 127) || Math.floor(velocity) !== velocity) throw new Error("Note " + i + " has an invalid velocity.");
      if (!(duration > 0 && beat + duration <= lengthBeats + 0.0001)) throw new Error("Note " + i + " has an invalid duration.");
      if (!(channel >= 0 && channel <= 15) || Math.floor(channel) !== channel) throw new Error("Note " + i + " has an invalid MIDI channel.");
      var pageStart = Math.floor(absoluteStep / CLIP_GRID_WIDTH) * CLIP_GRID_WIDTH;
      var key = String(pageStart);
      if (!pages[key]) pages[key] = [];
      pages[key].push({
         channel: channel,
         x: absoluteStep - pageStart,
         pitch: pitch,
         velocity: velocity,
         duration: duration
      });
      noteCount++;
   }
   return { pages: pages, pageStarts: Object.keys(pages).map(Number).sort(function(a, b) { return a - b; }), noteCount: noteCount };
}

function writeClipPages(targetClip, validated, pageIndex, callback) {
   if (pageIndex >= validated.pageStarts.length) {
      targetClip.scrollToStep(0);
      callback();
      return;
   }
   var pageStart = validated.pageStarts[pageIndex];
   targetClip.scrollToStep(pageStart);
   later(55, function() {
      try {
         var page = validated.pages[String(pageStart)];
         for (var i = 0; i < page.length; i++) {
            var note = page[i];
            targetClip.setStep(note.channel, note.x, note.pitch, note.velocity, note.duration);
         }
         writeClipPages(targetClip, validated, pageIndex + 1, callback);
      } catch (error) {
         callback(error);
      }
   });
}

// Note-start cells Bitwig reports for the launcher cursor clip's visible grid
// window, keyed "channel:x:pitch". init() registers onLauncherNoteStep, so the
// map follows every scroll; reads confirm each cell with getStep() before use.
var launcherNoteCells = {};

function onLauncherNoteStep(step) {
   var key = step.channel() + ":" + step.x() + ":" + step.y();
   if (String(step.state()) === "NoteOn") launcherNoteCells[key] = true;
   else delete launcherNoteCells[key];
}

// Reads every note in the launcher cursor clip from beat 0 to lengthBeats.
// Bitwig only exposes notes through its step grid, so a note that starts
// between steps comes back at the step it starts in (the result is quantized).
function readLauncherNotes(lengthBeats, stepSize, callback) {
   var stepCount = Math.ceil(lengthBeats / stepSize - 0.0001);
   var notes = [];
   launcherClip.setStepSize(stepSize);
   launcherClip.scrollToKey(0);

   function readPage(pageStart) {
      if (pageStart >= stepCount) {
         launcherClip.scrollToStep(0);
         notes.sort(function(a, b) { return a.beat - b.beat || a.pitch - b.pitch || a.channel - b.channel; });
         callback(null, notes);
         return;
      }
      launcherClip.scrollToStep(pageStart);
      later(180, function() {
         try {
            var keys = Object.keys(launcherNoteCells);
            for (var i = 0; i < keys.length; i++) {
               var parts = keys[i].split(":");
               var channel = Number(parts[0]);
               var x = Number(parts[1]);
               var pitch = Number(parts[2]);
               if (pageStart + x >= stepCount) continue;
               var step = launcherClip.getStep(channel, x, pitch);
               if (String(step.state()) !== "NoteOn") continue;
               notes.push({
                  beat: Math.round((pageStart + x) * stepSize * 1000000) / 1000000,
                  pitch: pitch,
                  velocity: Math.max(1, Math.min(127, Math.round(step.velocity() * 127))),
                  duration: step.duration(),
                  channel: channel,
                  muted: step.isMuted()
               });
            }
            readPage(pageStart + CLIP_GRID_WIDTH);
         } catch (error) {
            callback(error);
         }
      });
   }

   readPage(0);
}

// Compares a clip's read-back notes with the validated notes that were written
// and returns one line per difference: missing, changed, or unexpected notes.
function compareWrittenNotes(validated, stepSize, actual) {
   var expected = [];
   for (var i = 0; i < validated.pageStarts.length; i++) {
      var pageStart = validated.pageStarts[i];
      var page = validated.pages[String(pageStart)];
      for (var j = 0; j < page.length; j++) {
         var note = page[j];
         expected.push({ step: pageStart + note.x, pitch: note.pitch, velocity: note.velocity, duration: note.duration, channel: note.channel });
      }
   }
   var byCell = {};
   for (var k = 0; k < actual.length; k++) {
      var key = actual[k].channel + ":" + Math.round(actual[k].beat / stepSize) + ":" + actual[k].pitch;
      byCell[key] = actual[k];
   }
   var problems = [];
   for (var m = 0; m < expected.length; m++) {
      var want = expected[m];
      var cell = want.channel + ":" + want.step + ":" + want.pitch;
      var label = "pitch " + want.pitch + " at beat " + (want.step * stepSize) + " (channel " + want.channel + ")";
      var got = byCell[cell];
      if (!got || got.used) {
         problems.push(label + " is missing");
         continue;
      }
      got.used = true;
      var diffs = [];
      if (got.velocity !== want.velocity) diffs.push("velocity is " + got.velocity + ", requested " + want.velocity);
      if (Math.abs(got.duration - want.duration) > 0.001) diffs.push("duration is " + got.duration + ", requested " + want.duration);
      if (got.muted) diffs.push("note is muted");
      if (diffs.length) problems.push(label + ": " + diffs.join(", "));
   }
   for (var n = 0; n < actual.length; n++) {
      if (!actual[n].used) {
         problems.push("unexpected pitch " + actual[n].pitch + " at beat " + actual[n].beat + " (channel " + actual[n].channel + ")");
      }
   }
   return { expectedCount: expected.length, problems: problems };
}

// Bitwig shows MAX_SCENES launcher slots at a time. This scrolls that window
// until slotIndex is in view and calls callback(item, localIndex), where item
// is the track's slot, or the scene when track is null. The window goes back to
// the first scenes when the request ends.
function withSceneSlot(request, track, slotIndex, callback) {
   var sceneCount = sceneBank.itemCount().get();
   if (slotIndex >= sceneCount) {
      throw new Error("Slot " + slotIndex + " does not exist. The project has " + sceneCount + " scenes, so slots run from 0 to " + (sceneCount - 1) + ".");
   }
   // Run after any cleanup the request already has, such as putting the
   // selection back, and only add it once per request.
   if (!request.sceneWindowCleanup) {
      request.sceneWindowCleanup = true;
      var previousCleanup = request.cleanup;
      request.cleanup = function() {
         resetSceneWindow();
         if (previousCleanup) previousCleanup();
      };
   }
   var target = Math.floor(slotIndex / MAX_SCENES) * MAX_SCENES;
   var attempts = 0;
   function showSlot() {
      var position = sceneBank.scrollPosition().get();
      if (slotIndex >= position && slotIndex < position + MAX_SCENES) {
         var localIndex = slotIndex - position;
         callback(track ? track.clipLauncherSlotBank().getItemAt(localIndex) : sceneBank.getItemAt(localIndex), localIndex);
         return;
      }
      if (attempts++ >= 20) throw new Error("Bitwig did not scroll its scene window to slot " + slotIndex + ".");
      sceneBank.scrollPosition().set(target);
      later(50, showSlot);
   }
   showSlot();
}

function resetSceneWindow() {
   if (sceneBank.scrollPosition().get() !== 0) sceneBank.scrollPosition().set(0);
}

function requireSlotIndex(value, label) {
   var slotIndex = Number(value);
   if (!(slotIndex >= 0 && slotIndex < MAX_SCENE_SLOTS) || Math.floor(slotIndex) !== slotIndex) {
      throw new Error(label + " slot must be a whole number from 0 to " + (MAX_SCENE_SLOTS - 1) + ".");
   }
   return slotIndex;
}

function handleCreateNoteClip(request) {
   var params = request.params;
   var slotIndex = requireSlotIndex(params.slotIndex, "Clip");
   var lengthBeats = Number(params.lengthBeats);
   var stepSize = Number(params.stepSize || 0.25);
   if (!(lengthBeats >= 1 && lengthBeats <= 512) || Math.floor(lengthBeats) !== lengthBeats) {
      throw new Error("Clip length must be a whole number from 1 to 512 beats.");
   }
   if (!(stepSize >= 0.03125 && stepSize <= 4)) throw new Error("Clip step size must be between 1/128 and 4 beats.");
   var validated = validateClipNotes(params.notes || [], stepSize, lengthBeats);

   selectTrack(request, params, function(track) {
      var sceneCount = sceneBank.itemCount().get();
      if (slotIndex > sceneCount) {
         throw new Error("Slot " + slotIndex + " is past the end of the launcher. The project has " + sceneCount +
            " scenes, so a new clip can go in slot " + sceneCount + " at most.");
      }
      if (slotIndex === sceneCount) {
         createInNewScene(request, track, slotIndex, lengthBeats, function() {
            withSceneSlot(request, track, slotIndex, function(slot) {
               fillNewClip(request, params, slot, slotIndex, lengthBeats, stepSize, validated);
            });
         });
         return;
      }
      withSceneSlot(request, track, slotIndex, function(slot) {
         later(100, function() {
            try {
               if (slot.hasContent().get() && !params.replace) {
                  throw new Error("Clip slot " + slotIndex + " already has content. Pass replace=true to replace it.");
               }

               function createClip() {
                  slot.createEmptyClip(lengthBeats);
                  fillNewClip(request, params, slot, slotIndex, lengthBeats, stepSize, validated);
               }

               if (slot.hasContent().get()) {
                  slot.deleteObject();
                  later(180, createClip);
               } else createClip();
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
      });
   });
}

// Bitwig creates the clip and a new scene for it when slotIndex is one past
// the last scene, then reports the extra scene.
function createInNewScene(request, track, slotIndex, lengthBeats, callback) {
   track.createNewLauncherClip(slotIndex, lengthBeats);
   var attempts = 0;
   function waitForScene() {
      if (sceneBank.itemCount().get() > slotIndex) {
         callback();
         return;
      }
      if (attempts++ >= 20) throw new Error("Bitwig did not add a scene for the new clip in slot " + slotIndex + ".");
      later(50, waitForScene);
   }
   later(50, waitForScene);
}

// Selects a freshly created clip, writes its settings and notes, and reads
// every note back.
function fillNewClip(request, params, slot, slotIndex, lengthBeats, stepSize, validated) {
   later(180, function() {
      try {
         slot.select();
         later(180, function() {
            try {
               if (!launcherClip.exists().get()) throw new Error("Bitwig did not expose the new launcher clip.");
               launcherClip.setStepSize(stepSize);
               launcherClip.scrollToKey(0);
               launcherClip.scrollToStep(0);
               launcherClip.setName(String(params.clipName));
               launcherClip.getLoopStart().set(0);
               launcherClip.getLoopLength().set(lengthBeats);
               launcherClip.getPlayStart().set(0);
               launcherClip.getPlayStop().set(lengthBeats);
               launcherClip.isLoopEnabled().set(true);
               writeClipPages(launcherClip, validated, 0, function(error) {
                  if (error) {
                     finish(request, false, { message: String(error.message || error) });
                     return;
                  }
                  later(280, function() {
                     try {
                        var snapshot = clipSnapshot(slot, slotIndex);
                        if (!snapshot.hasContent) throw new Error("Bitwig did not confirm clip content.");
                        readLauncherNotes(lengthBeats, stepSize, function(readError, actual) {
                           if (readError) {
                              finish(request, false, { message: "Could not read the clip back after writing: " + String(readError.message || readError) });
                              return;
                           }
                           var check = compareWrittenNotes(validated, stepSize, actual);
                           if (check.problems.length) {
                              var shown = check.problems.slice(0, 5).join("; ");
                              var more = check.problems.length > 5 ? "; and " + (check.problems.length - 5) + " more" : "";
                              finish(request, false, {
                                 message: "Note verification failed: clip slot " + slotIndex + " does not match the " + check.expectedCount + " requested notes after writing. " + shown + more + "."
                              });
                              return;
                           }
                           finish(request, true, {
                              track: { index: params.trackIndex, name: params.trackName },
                              clip: clipSnapshot(slot, slotIndex),
                              lengthBeats: launcherClip.getLoopLength().get(),
                              stepSize: stepSize,
                              notesWritten: validated.noteCount,
                              notesVerified: actual.length
                           });
                        });
                     } catch (verificationError) {
                        finish(request, false, { message: String(verificationError.message || verificationError) });
                     }
                  });
               });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
      } catch (error) {
         finish(request, false, { message: String(error.message || error) });
      }
   });
}

function handleClipNotes(request) {
   var params = request.params;
   var slotIndex = requireSlotIndex(params.slotIndex, "Clip");
   var stepSize = Number(params.stepSize || 0.25);
   if (!(stepSize >= 0.03125 && stepSize <= 4)) throw new Error("Clip step size must be between 1/128 and 4 beats.");

   selectTrack(request, params, function(track) {
      withSceneSlot(request, track, slotIndex, function(slot) {
         if (!slot.hasContent().get()) throw new Error("Clip slot " + slotIndex + " has no clip.");
         slot.select();
         slot.showInEditor();
         later(240, function() {
            try {
               if (!launcherClip.exists().get()) throw new Error("Bitwig did not expose the launcher clip in slot " + slotIndex + ".");
               var loopStart = launcherClip.getLoopStart().get();
               var loopLength = launcherClip.getLoopLength().get();
               var lengthBeats = loopStart + loopLength;
               if (!(lengthBeats > 0 && lengthBeats <= 512)) {
                  throw new Error("Clips must end within 512 beats to be read; this one ends at beat " + lengthBeats + ".");
               }
               readLauncherNotes(lengthBeats, stepSize, function(error, notes) {
                  if (error) {
                     finish(request, false, { message: String(error.message || error) });
                     return;
                  }
                  finish(request, true, {
                     track: { index: params.trackIndex, name: params.trackName },
                     clip: clipSnapshot(slot, slotIndex),
                     lengthBeats: lengthBeats,
                     loopStartBeats: loopStart,
                     loopLengthBeats: loopLength,
                     stepSize: stepSize,
                     quantized: true,
                     noteCount: notes.length,
                     notes: notes
                  });
               });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
      });
   });
}

function handleRecordLauncherArrangement(request) {
   var specifications = request.params.regions || [];
   if (!specifications.length) throw new Error("At least one arrangement region is required.");
   if (specifications.length > 64) throw new Error("A maximum of 64 arrangement regions can be recorded at once.");
   // The print reads slots 0-7 through the first scene window.
   if (sceneBank.scrollPosition().get() !== 0) {
      resetSceneWindow();
      throw new Error("Bitwig's scene window was still scrolled from the previous request. Try again.");
   }

   var trackPlans = {};
   var orderedTrackPlans = [];
   var startPosition = Infinity;
   var endBeats = 0;
   for (var regionIndex = 0; regionIndex < specifications.length; regionIndex++) {
      var region = specifications[regionIndex];
      var track = requireTrack(region);
      var slotIndex = Number(region.slotIndex);
      var startBeats = Number(region.startBeats);
      var lengthBeats = Number(region.lengthBeats);
      if (!(slotIndex >= 0 && slotIndex < MAX_SCENES) || Math.floor(slotIndex) !== slotIndex) {
         throw new Error("Region " + regionIndex + " has an invalid launcher slot.");
      }
      if (!(startBeats >= 0)) throw new Error("Region " + regionIndex + " has an invalid start position.");
      if (!(lengthBeats >= 1 && lengthBeats <= 512) || Math.floor(lengthBeats) !== lengthBeats) {
         throw new Error("Region " + regionIndex + " must be between 1 and 512 whole beats long.");
      }
      var sourceSlot = track.clipLauncherSlotBank().getItemAt(slotIndex);
      if (!sourceSlot.hasContent().get()) {
         throw new Error("Track ‘" + region.trackName + "’ launcher slot " + slotIndex + " has no clip to record.");
      }
      var trackKey = String(region.trackIndex);
      var plan = trackPlans[trackKey];
      if (!plan) {
         plan = {
            track: track,
            trackIndex: Number(region.trackIndex),
            trackName: String(region.trackName),
            slotIndex: slotIndex,
            intervals: []
         };
         trackPlans[trackKey] = plan;
         orderedTrackPlans.push(plan);
      } else if (plan.slotIndex !== slotIndex) {
         throw new Error("Each track must use one launcher slot throughout a recorded arrangement.");
      }
      plan.intervals.push({ start: startBeats, end: startBeats + lengthBeats });
      endBeats = Math.max(endBeats, startBeats + lengthBeats);
      startPosition = Math.min(startPosition, startBeats);
   }

   var events = [];
   var recordedIntervals = [];
   for (var planIndex = 0; planIndex < orderedTrackPlans.length; planIndex++) {
      var trackPlan = orderedTrackPlans[planIndex];
      trackPlan.intervals.sort(function(a, b) { return a.start - b.start; });
      var merged = [];
      for (var intervalIndex = 0; intervalIndex < trackPlan.intervals.length; intervalIndex++) {
         var interval = trackPlan.intervals[intervalIndex];
         var last = merged.length ? merged[merged.length - 1] : null;
         if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
         else merged.push({ start: interval.start, end: interval.end });
      }
      for (var mergedIndex = 0; mergedIndex < merged.length; mergedIndex++) {
         var mergedInterval = merged[mergedIndex];
         events.push({ beat: mergedInterval.start, type: "start", plan: trackPlan });
         events.push({ beat: mergedInterval.end, type: "stop", plan: trackPlan });
         recordedIntervals.push({
            trackIndex: trackPlan.trackIndex,
            trackName: trackPlan.trackName,
            slotIndex: trackPlan.slotIndex,
            startBeats: mergedInterval.start,
            lengthBeats: mergedInterval.end - mergedInterval.start
         });
      }
   }
   events.sort(function(a, b) {
      if (a.beat !== b.beat) return a.beat - b.beat;
      return a.type === "stop" ? -1 : 1;
   });

   var spanBeats = endBeats - startPosition;
   if (spanBeats > MAX_PRINT_SPAN_BEATS) {
      throw new Error("The regions run from beat " + startPosition + " to beat " + endBeats + ", " + spanBeats +
         " beats in one print. One print can cover at most " + MAX_PRINT_SPAN_BEATS + " beats; split it into smaller prints.");
   }

   // Recording runs at an accelerated tempo; put the project's own tempo back
   // afterwards unless the caller asks for a specific one.
   var restoreTempo = request.params.restoreTempo === undefined || request.params.restoreTempo === null
      ? transport.tempo().value().getRaw()
      : Number(request.params.restoreTempo);
   if (!(restoreTempo >= 20 && restoreTempo <= 666)) throw new Error("Restore tempo must be between 20 and 666 BPM.");

   // Everything the print changes is put back by restoreState, on success, on
   // any error, and when the watchdog gives up on the request.
   var saved = {
      loopEnabled: transport.isArrangerLoopEnabled().get(),
      position: transport.getPosition().get(),
      arrangerOverdub: transport.isArrangerOverdubEnabled().get(),
      launcherOverdub: transport.isClipLauncherOverdubEnabled().get(),
      armedTracks: []
   };
   var trackCount = Math.min(trackBank.itemCount().get(), MAX_TRACKS);
   for (var armIndex = 0; armIndex < trackCount; armIndex++) {
      var candidate = trackBank.getItemAt(armIndex);
      if (candidate.exists().get() && candidate.arm().get()) saved.armedTracks.push(candidate);
   }
   var acceleratedTempo = 666;
   var nextEvent = 0;
   var startTimestamp = Date.now();
   var completed = false;
   var restored = false;

   function restoreState() {
      if (restored) return;
      restored = true;
      transport.stop();
      transport.isArrangerRecordEnabled().set(false);
      for (var planIndex = 0; planIndex < orderedTrackPlans.length; planIndex++) {
         orderedTrackPlans[planIndex].track.stop();
         orderedTrackPlans[planIndex].track.returnToArrangement();
      }
      transport.isArrangerLoopEnabled().set(saved.loopEnabled);
      transport.isArrangerOverdubEnabled().set(saved.arrangerOverdub);
      transport.isClipLauncherOverdubEnabled().set(saved.launcherOverdub);
      for (var armIndex = 0; armIndex < saved.armedTracks.length; armIndex++) saved.armedTracks[armIndex].arm().set(true);
      transport.tempo().value().setRaw(restoreTempo);
      transport.setPosition(saved.position);
      // Bitwig drops a playhead move made while the transport is still
      // stopping, so move it again once the stop has landed.
      host.scheduleTask(function() { transport.setPosition(saved.position); }, 200);
   }
   request.cleanup = restoreState;

   function fail(error) {
      if (completed) return;
      completed = true;
      restoreState();
      finish(request, false, { message: String(error.message || error), recordedIntervals: recordedIntervals });
   }

   function complete() {
      if (completed) return;
      completed = true;
      restoreState();
      later(450, function() {
         finish(request, true, {
            recorded: true,
            tracks: orderedTrackPlans.length,
            regionsRequested: specifications.length,
            mergedIntervals: recordedIntervals.length,
            startBeats: startPosition,
            endBeats: endBeats,
            acceleratedTempo: acceleratedTempo,
            restoredTempo: transport.tempo().value().getRaw(),
            restoredPositionBeats: transport.getPosition().get(),
            restoredArmedTracks: saved.armedTracks.length,
            durationMs: Date.now() - startTimestamp,
            intervals: recordedIntervals,
            projectModified: project.isModified().get(),
            arrangerRecordEnabled: transport.isArrangerRecordEnabled().get()
         });
      });
   }

   function runDueEvents(positionBeats) {
      while (nextEvent < events.length) {
         var event = events[nextEvent];
         var atStart = event.beat === startPosition;
         var leadBeats = atStart ? 0 : 0.75;
         if (positionBeats < event.beat - leadBeats) break;
         if (event.type === "start") {
            event.plan.track.clipLauncherSlotBank().getItemAt(event.plan.slotIndex)
               .launchWithOptions(atStart ? "none" : "1", "from_start");
         } else event.plan.track.stop();
         nextEvent++;
      }
   }

   function monitorRecording() {
      if (completed || restored) return;
      try {
         var positionBeats = transport.getPosition().get();
         runDueEvents(positionBeats);
         if (positionBeats >= endBeats + 0.5) {
            complete();
            return;
         }
         if (!transport.isPlaying().get()) {
            throw new Error("Bitwig's transport stopped at beat " + positionBeats + " before the print reached beat " + endBeats + ".");
         }
         if (Date.now() - startTimestamp > 115000) {
            throw new Error("Timed out while recording Launcher clips into the Arranger.");
         }
         later(10, monitorRecording);
      } catch (error) {
         fail(error);
      }
   }

   function stillArmed() {
      for (var armIndex = 0; armIndex < saved.armedTracks.length; armIndex++) {
         if (saved.armedTracks[armIndex].arm().get()) return true;
      }
      return false;
   }

   function moveToStart() {
      transport.setPosition(startPosition);
      if (startPosition === 0) jumpToBeginningAction.invoke();
   }

   try {
      transport.stop();
      transport.isArrangerRecordEnabled().set(false);
      transport.isArrangerLoopEnabled().set(false);
      transport.isArrangerOverdubEnabled().set(false);
      transport.isClipLauncherOverdubEnabled().set(false);
      for (var unarmIndex = 0; unarmIndex < saved.armedTracks.length; unarmIndex++) saved.armedTracks[unarmIndex].arm().set(false);
      for (var stopIndex = 0; stopIndex < orderedTrackPlans.length; stopIndex++) orderedTrackPlans[stopIndex].track.stop();
      transport.tempo().value().setRaw(acceleratedTempo);
      moveToStart();
   } catch (error) {
      fail(error);
      return;
   }
   var preparationAttempts = 0;
   function retryOr(message) {
      if (preparationAttempts++ < 30) {
         later(100, beginWhenReady);
         return;
      }
      throw new Error(message);
   }
   function beginWhenReady() {
      if (completed || restored) return;
      try {
         if (Math.abs(transport.tempo().value().getRaw() - acceleratedTempo) > 0.01) {
            retryOr("Bitwig did not verify the temporary recording tempo.");
            return;
         }
         if (transport.isArrangerLoopEnabled().get()) {
            transport.isArrangerLoopEnabled().set(false);
            retryOr("Bitwig did not disable the Arranger loop for recording.");
            return;
         }
         if (transport.isArrangerOverdubEnabled().get() || transport.isClipLauncherOverdubEnabled().get()) {
            transport.isArrangerOverdubEnabled().set(false);
            transport.isClipLauncherOverdubEnabled().set(false);
            retryOr("Bitwig did not turn off overdub for recording.");
            return;
         }
         if (stillArmed()) {
            for (var armIndex = 0; armIndex < saved.armedTracks.length; armIndex++) saved.armedTracks[armIndex].arm().set(false);
            retryOr("Bitwig did not disarm the armed tracks for recording.");
            return;
         }
         if (Math.abs(transport.getPosition().get() - startPosition) > 0.01) {
            moveToStart();
            retryOr("Bitwig did not verify the recording start position at beat " + startPosition + ".");
            return;
         }
         transport.isArrangerRecordEnabled().set(true);
         runDueEvents(startPosition);
         transport.play();
         later(180, function() {
            if (!transport.isPlaying().get()) {
               fail(new Error("Bitwig did not start the Arranger recording transport."));
               return;
            }
            monitorRecording();
         });
      } catch (error) {
         fail(error);
      }
   }
   later(350, beginWhenReady);
}

function handleListClips(request) {
   var params = request.params;
   var track = requireTrack(params);
   var sceneCount = Math.min(sceneBank.itemCount().get(), MAX_SCENE_SLOTS);
   var clips = [];
   function readWindow(windowStart) {
      if (windowStart >= sceneCount) {
         finish(request, true, {
            track: { index: params.trackIndex, name: params.trackName },
            sceneCount: sceneBank.itemCount().get(),
            clips: clips
         });
         return;
      }
      withSceneSlot(request, track, windowStart, function(firstSlot, firstLocal) {
         later(60, function() {
            var slots = track.clipLauncherSlotBank();
            var position = windowStart - firstLocal;
            var end = Math.min(position + MAX_SCENES, sceneCount);
            for (var slotIndex = windowStart; slotIndex < end; slotIndex++) {
               var snapshot = clipSnapshot(slots.getItemAt(slotIndex - position), slotIndex);
               if (snapshot.hasContent) clips.push(snapshot);
            }
            readWindow(end);
         });
      });
   }
   later(120, function() {
      readWindow(0);
   });
}

function handleLaunchScene(request) {
   var slotIndex = requireSlotIndex(request.params.slotIndex, "Scene");
   withSceneSlot(request, null, slotIndex, function(scene) {
      scene.launchWithOptions("none", "from_start");
      later(180, function() {
         finish(request, true, { slotIndex: slotIndex, transport: readTransport() });
      });
   });
}

function dispatch(request) {
   var params = request.params;
   switch (request.method) {
      case "status":
         finish(request, true, {
            connected: true,
            bridge: "Control Deck Bridge",
            version: CONTROL_DECK_VERSION,
            apiVersion: 18,
            project: application.projectName().get(),
            projectModified: project.isModified().get(),
            transport: readTransport(),
            selectedTrack: cursorTrack.exists().get() ? { name: cursorTrack.name().get(), position: cursorTrack.position().get() } : null,
            selectedDevice: cursorDevice.exists().get() ? { name: cursorDevice.name().get(), position: cursorDevice.position().get() } : null
         });
         return;
      case "transport":
         handleTransport(request);
         return;
      case "cue_markers":
         handleCueMarkers(request);
         return;
      case "audio_engine":
         var engineAction = String(params.action || "status");
         if (engineAction === "activate") application.activateEngine();
         else if (engineAction === "deactivate") application.deactivateEngine();
         else if (engineAction !== "status") throw new Error("Audio engine action must be status, activate, or deactivate.");
         later(engineAction === "status" ? 1 : 1000, function() {
            finish(request, true, { active: application.hasActiveEngine().get(), action: engineAction });
         });
         return;
      case "restart_bridge":
         finish(request, true, { restarting: true, version: CONTROL_DECK_VERSION });
         // Runs after the request is answered, so it can't go through later().
         host.scheduleTask(function() { host.restart(); }, 100);
         return;
      case "find_actions":
         var actionQuery = String(params.query || "").toLowerCase();
         var allActions = application.getActions();
         var matchingActions = [];
         for (var actionIndex = 0; actionIndex < allActions.length; actionIndex++) {
            var candidate = allActions[actionIndex];
            var candidateText = (candidate.getId() + " " + candidate.getName() + " " + candidate.getMenuItemText()).toLowerCase();
            if (!actionQuery || candidateText.indexOf(actionQuery) !== -1) {
               matchingActions.push({
                  id: candidate.getId(),
                  name: candidate.getName(),
                  menuItemText: candidate.getMenuItemText()
               });
               if (matchingActions.length >= 100) break;
            }
         }
         finish(request, true, { query: actionQuery, actions: matchingActions });
         return;
      case "invoke_action":
         var requestedActionId = String(params.actionId || "");
         var requestedAction = application.getAction(requestedActionId);
         if (!requestedAction) {
            finish(request, false, { message: "Bitwig action ‘" + requestedActionId + "’ was not found." });
            return;
         }
         requestedAction.invoke();
         later(180, function() {
            finish(request, true, { id: requestedActionId, invoked: true });
         });
         return;
      case "selection_state":
         finish(request, true, {
            device: cursorDevice.exists().get() ? deviceSnapshot(cursorDevice, cursorDevice.position().get()) : null,
            slotNames: arrayCopy(cursorDevice.slotNames().get()),
            cursorSlot: {
               exists: cursorDeviceSlot.exists().get(),
               name: cursorDeviceSlot.name().get()
            },
            nested: listNestedDevicesNow()
         });
         return;
      case "list_tracks":
         finish(request, true, listTracks());
         return;
      case "list_actions":
         var actionQuery = normalizeText(params.query || "");
         var availableActions = application.getActions();
         var matchingActions = [];
         for (var actionIndex = 0; actionIndex < availableActions.length; actionIndex++) {
            var availableAction = availableActions[actionIndex];
            var actionId = String(availableAction.getId() || "");
            var actionName = String(availableAction.getName() || "");
            var actionMenuText = String(availableAction.getMenuItemText() || "");
            var actionSearchText = normalizeText(actionId + " " + actionName + " " + actionMenuText);
            if (!actionQuery || actionSearchText.indexOf(actionQuery) !== -1) {
               matchingActions.push({ id: actionId, name: actionName, menuItemText: actionMenuText });
            }
         }
         finish(request, true, {
            query: String(params.query || ""),
            totalActions: availableActions.length,
            matched: matchingActions.length,
            actions: matchingActions.slice(0, 500)
         });
         return;
      case "track_meters":
         if (params.action === "reset") {
            for (var meterIndex = 0; meterIndex < MAX_TRACKS; meterIndex++) {
               trackMeterLatest[meterIndex] = 0;
               trackMeterMaximum[meterIndex] = 0;
            }
            finish(request, true, { reset: true, range: 128 });
         } else finish(request, true, readTrackMeters(Boolean(params.resetAfterRead)));
         return;
      case "create_track":
         handleCreateTrack(request);
         return;
      case "set_track_mix":
         handleSetTrackMix(request);
         return;
      case "rename_track":
         handleRenameTrack(request);
         return;
      case "delete_track":
         var track = requireTrack(params);
         var deletedTrack = trackSnapshot(track, Number(params.trackIndex));
         var trackCountBefore = trackBank.itemCount().get();
         track.deleteObject();
         later(250, function() {
            finish(request, true, { deleted: deletedTrack, verifiedCount: trackBank.itemCount().get(), previousCount: trackCountBefore });
         });
         return;
      case "list_devices":
         selectTrack(request, params, function() {
            var snapshot = listDevicesNow();
            snapshot.track = { index: params.trackIndex, name: params.trackName };
            finish(request, true, snapshot);
         });
         return;
      case "nest_device":
         handleNestDevice(request);
         return;
      case "save_device_preset":
         handleSaveDevicePreset(request);
         return;
      case "create_note_clip":
         handleCreateNoteClip(request);
         return;
      case "clip_notes":
         handleClipNotes(request);
         return;
      case "arrange_launcher_clips":
         handleRecordLauncherArrangement(request);
         return;
      case "list_clips":
         handleListClips(request);
         return;
      case "launch_scene":
         handleLaunchScene(request);
         return;
      case "find_devices":
         handleFindDevices(request);
         return;
      case "insert_device":
         handleInsertDevice(request);
         return;
      case "insert_bitwig_device":
         handleInsertBitwigDevice(request);
         return;
      case "insert_clap_device":
         handleInsertClapDevice(request);
         return;
      case "find_samples":
         handleFindSamples(request);
         return;
      case "insert_sample":
         handleInsertSample(request);
         return;
      case "insert_sample_file":
         handleInsertSampleFile(request);
         return;
      case "delete_device":
         selectTrack(request, params, function() {
            try {
               var device = requireDevice(params);
               var deleted = deviceSnapshot(device, Number(params.deviceIndex));
               var before = deviceBank.itemCount().get();
               device.deleteObject();
               later(250, function() {
                  finish(request, true, { deleted: deleted, previousCount: before, verifiedCount: deviceBank.itemCount().get() });
               });
            } catch (error) {
               finish(request, false, { message: String(error.message || error) });
            }
         });
         return;
      case "list_parameters":
         selectDevice(request, params, function(device) {
            var query = normalizeText(params.query || "");
            var filtered = [];
            for (var i = 0; i < directIds.length; i++) {
               var parameter = parameterSnapshot(directIds[i]);
               if (!query || normalizeText(parameter.name).indexOf(query) !== -1) filtered.push(parameter);
            }
            var offset = Math.max(0, Number(params.offset || 0));
            var limit = Math.max(1, Math.min(200, Number(params.limit || 100)));
            finish(request, true, {
               device: deviceSnapshot(cursorDevice, Number(params.deviceIndex)),
               totalDirectParameters: directIds.length,
               matched: filtered.length,
               offset: offset,
               returned: Math.min(limit, Math.max(0, filtered.length - offset)),
               parameters: filtered.slice(offset, offset + limit)
            });
         });
         return;
      case "remote_controls":
         selectDevice(request, params, function(device) {
            var action = String(params.action || "status");
            if (action !== "status" && action !== "show" && action !== "hide") {
               throw new Error("Remote-controls action must be status, show, or hide.");
            }
            var pageNames = arrayCopy(cursorRemoteControlsPage.pageNames().get());
            var requestedIndex = params.pageIndex === undefined ? null : Number(params.pageIndex);
            if (params.pageName !== undefined) {
               var requestedName = normalizeText(params.pageName);
               requestedIndex = -1;
               for (var pageIndex = 0; pageIndex < pageNames.length; pageIndex++) {
                  if (normalizeText(pageNames[pageIndex]) === requestedName) {
                     requestedIndex = pageIndex;
                     break;
                  }
               }
               if (requestedIndex < 0) {
                  throw new Error("Remote-control page ‘" + params.pageName + "’ is not available on this device.");
               }
            }
            if (requestedIndex !== null) {
               if (!isFinite(requestedIndex) || requestedIndex < 0 || requestedIndex >= pageNames.length) {
                  throw new Error("Remote-control page index " + requestedIndex + " is not available on this device.");
               }
            }

            // The cursor can target a device for controller purposes without
            // moving Bitwig's visible Device Panel editor. Select the exact
            // bank item in the editor first, then reveal its native Remote
            // Controls pane. Otherwise the host can select the requested page
            // while leaving the plug-in's long generic parameter view onscreen.
            if (action !== "status") device.selectInEditor();
            later(action === "status" ? 1 : 120, function() {
               try {
                  if (action === "show") {
                     // Keep the eight soft controls visible while collapsing
                     // the plug-in's long generic parameter body.
                     device.isExpanded().set(false);
                     device.isRemoteControlsSectionVisible().set(true);
                     device.isParameterPageSectionVisible().set(false);
                  } else if (action === "hide") {
                     device.isRemoteControlsSectionVisible().set(false);
                  }
                  if (requestedIndex !== null) cursorRemoteControlsPage.selectedPageIndex().set(requestedIndex);
                  later(250, function() {
                     finish(request, true, remoteControlsSnapshot());
                  });
               } catch (error) {
                  finish(request, false, { message: String(error.message || error) });
               }
            });
         });
         return;
      case "selected_device_remote_controls":
         try {
            var selectedAction = String(params.action || "status");
            var expectedSelectedName = String(params.deviceName || "").trim();
            if (selectedAction !== "status" && selectedAction !== "show" && selectedAction !== "hide") {
               throw new Error("Remote-controls action must be status, show, or hide.");
            }
            if (!cursorDevice.exists().get()) throw new Error("No Bitwig device is currently selected.");
            if (expectedSelectedName && cursorDevice.name().get() !== expectedSelectedName) {
               throw new Error("Safety check failed: the selected device is ‘" + cursorDevice.name().get() + "’, not ‘" + expectedSelectedName + "’.");
            }
            var selectedPageNames = arrayCopy(cursorRemoteControlsPage.pageNames().get());
            var selectedPageIndex = params.pageIndex === undefined ? null : Number(params.pageIndex);
            if (params.pageName !== undefined) {
               var selectedRequestedName = normalizeText(params.pageName);
               selectedPageIndex = -1;
               for (var selectedIndex = 0; selectedIndex < selectedPageNames.length; selectedIndex++) {
                  if (normalizeText(selectedPageNames[selectedIndex]) === selectedRequestedName) {
                     selectedPageIndex = selectedIndex;
                     break;
                  }
               }
               if (selectedPageIndex < 0) {
                  throw new Error("Remote-control page ‘" + params.pageName + "’ is not available on the selected device.");
               }
            }
            if (selectedPageIndex !== null &&
               (!isFinite(selectedPageIndex) || selectedPageIndex < 0 || selectedPageIndex >= selectedPageNames.length)) {
               throw new Error("Remote-control page index " + selectedPageIndex + " is not available on the selected device.");
            }
            if (selectedAction !== "status") cursorDevice.selectInEditor();
            later(selectedAction === "status" ? 1 : 120, function() {
               try {
                  if (selectedAction === "show") {
                     // A nested device must remain expanded for Bitwig to draw
                     // its Remote Controls section. Hide only the long generic
                     // parameter page so the compact eight controls stay visible.
                     cursorDevice.isExpanded().set(true);
                     cursorDevice.isRemoteControlsSectionVisible().set(true);
                     cursorDevice.isParameterPageSectionVisible().set(false);
                  } else if (selectedAction === "hide") {
                     cursorDevice.isRemoteControlsSectionVisible().set(false);
                  }
                  if (selectedPageIndex !== null) cursorRemoteControlsPage.selectedPageIndex().set(selectedPageIndex);
                  later(250, function() {
                     finish(request, true, {
                        device: deviceSnapshot(cursorDevice, cursorDevice.position().get()),
                        remoteControls: remoteControlsSnapshot()
                     });
                  });
               } catch (error) {
                  finish(request, false, { message: String(error.message || error) });
               }
            });
         } catch (error) {
            finish(request, false, { message: String(error.message || error) });
         }
         return;
      case "set_remote_control":
         selectDevice(request, params, function() {
            var requested = Number(params.value);
            if (!(requested >= 0 && requested <= 1)) {
               finish(request, false, { message: "Normalized remote-control value must be between 0 and 1." });
               return;
            }
            var pageNames = arrayCopy(cursorRemoteControlsPage.pageNames().get());
            var pageIndex = params.pageIndex === undefined
               ? pageNames.indexOf(String(params.pageName || ""))
               : Number(params.pageIndex);
            if (!(pageIndex >= 0 && pageIndex < pageNames.length)) {
               finish(request, false, { message: "Remote Controls page was not found." });
               return;
            }
            cursorRemoteControlsPage.selectedPageIndex().set(pageIndex);
            later(200, function() {
               var controlIndex = params.controlIndex === undefined ? -1 : Number(params.controlIndex);
               if (controlIndex < 0 && params.controlName !== undefined) {
                  var requestedName = String(params.controlName);
                  for (var i = 0; i < 8; i++) {
                     if (cursorRemoteControlsPage.getParameter(i).name().get() === requestedName) {
                        controlIndex = i;
                        break;
                     }
                  }
               }
               if (!(controlIndex >= 0 && controlIndex < 8)) {
                  finish(request, false, { message: "Remote control was not found on page ‘" + pageNames[pageIndex] + "’." });
                  return;
               }
               var control = cursorRemoteControlsPage.getParameter(controlIndex);
               if (!control.exists().get()) {
                  finish(request, false, { message: "The requested Remote Control slot is empty." });
                  return;
               }
               control.setImmediately(requested);
               later(400, function() {
                  var actual = control.get();
                  if (differs(actual, requested, 0.02)) {
                     finish(request, false, {
                        message: "Bitwig did not confirm ‘" + control.name().get() + "’: it reads " + actual +
                           " (" + control.displayedValue().get() + "), requested " + requested +
                           ". The control may snap to fixed steps."
                     });
                     return;
                  }
                  finish(request, true, {
                     pageIndex: pageIndex,
                     pageName: pageNames[pageIndex],
                     controlIndex: controlIndex,
                     controlName: control.name().get(),
                     requestedNormalizedValue: requested,
                     actualNormalizedValue: actual,
                     displayValue: control.displayedValue().get(),
                     verifiedByBitwigReadback: Math.abs(actual - requested) <= 0.02
                  });
               });
            });
         });
         return;
      case "set_parameter":
         selectDevice(request, params, function(device) {
            var id = String(params.parameterId);
            if (directIds.indexOf(id) === -1) {
               finish(request, false, { message: "Parameter ID ‘" + id + "’ is not exposed by the selected device. Refresh its parameters." });
               return;
            }
            var requested = Number(params.value);
            if (!(requested >= 0 && requested <= 1)) {
               finish(request, false, { message: "Normalized parameter value must be between 0 and 1." });
               return;
            }
            // Bitwig's bundled generic-device controllers use 128 here. It is
            // also the portable resolution for VST3 direct parameters; larger
            // resolutions are accepted by stock devices but some plug-ins
            // apply their own second scaling pass.
            var resolution = cursorDevice.name().get().indexOf("MatrixBrute") !== -1 &&
               directNames[id] === "Preset" ? 256 : 128;
            var scaledValue = Math.round(requested * (resolution - 1));
            var parameterDevice = resolution === 256 ? cursorDevice : device;
            // Write through the exact device-bank item, not the cursor. This
            // matters when a chain contains several devices with the same
            // name and identical parameter IDs (such as MatrixBrute CC banks).
            parameterDevice.setDirectParameterValueNormalized(id, scaledValue, resolution);
            later(400, function() {
               var actual = directValues[id];
               var difference = actual === undefined ? null : Math.abs(actual - requested);
               var doubleNormalized = parameterDevice.isPlugin().get() &&
                  requested > 0.02 && actual !== undefined && actual < 0.001 &&
                  Math.abs((actual * 16384) - requested) <= 0.02;

               function reply(mode, writtenValue) {
                  actual = directValues[id];
                  difference = actual === undefined ? null : Math.abs(actual - requested);
                  if (!(actual !== undefined && difference <= 0.02)) {
                     finish(request, false, {
                        message: "Bitwig did not confirm parameter ‘" + (directNames[id] || id) + "’: it reads " +
                           (actual === undefined ? "no value" : actual) + ", requested " + requested +
                           ". The parameter may snap to fixed steps or ignore remote changes."
                     });
                     return;
                  }
                  finish(request, true, {
                     parameter: parameterSnapshot(id),
                     requestedNormalizedValue: requested,
                     scaledIntegerValue: writtenValue,
                     resolution: resolution,
                     compatibilityMode: mode,
                     actualNormalizedValue: actual,
                     difference: difference,
                     verifiedByBitwigReadback: actual !== undefined && difference <= 0.02
                  });
               }

               if (!doubleNormalized) {
                  reply("standard", scaledValue);
                  return;
               }

               // Some nonlinear VST3 parameters are normalized a second time
               // by Bitwig. Only compensate after readback proves that exact
               // 1/16384 signature, then verify the compensated result again.
               var compatibilityValue = scaledValue * 16384;
               parameterDevice.setDirectParameterValueNormalized(id, compatibilityValue, resolution);
               later(400, function() { reply("vst3-double-normalization", compatibilityValue); });
            });
         });
         return;
      case "open_device_window":
         selectDevice(request, params, function() {
            cursorDevice.isWindowOpen().set(true);
            later(120, function() {
               finish(request, true, { device: cursorDevice.name().get(), windowOpen: cursorDevice.isWindowOpen().get() });
            });
         });
         return;
      default:
         throw new Error("Unknown Control Deck method: " + request.method);
   }
}

function markTrack(track) {
   interested(track.exists());
   interested(track.name());
   interested(track.trackType());
   interested(track.position());
   interested(track.mute());
   interested(track.solo());
   interested(track.arm());
   interested(track.volume());
   interested(track.volume().displayedValue());
   interested(track.pan());
   interested(track.pan().displayedValue());
}

function observeTrackMeter(track, index) {
   track.addVuMeterObserver(128, -1, true, function(value) {
      var numeric = Number(value || 0);
      trackMeterLatest[index] = numeric;
      if (numeric > Number(trackMeterMaximum[index] || 0)) trackMeterMaximum[index] = numeric;
   });
}

function markDevice(device) {
   interested(device.exists());
   interested(device.name());
   interested(device.deviceType());
   interested(device.position());
   interested(device.isNested());
   interested(device.isPlugin());
   interested(device.isEnabled());
   interested(device.isWindowOpen());
   interested(device.presetName());
   interested(device.sampleName());
}

function markBrowserItem(item) {
   interested(item.exists());
   interested(item.name());
   interested(item.isSelected());
}

function markCueMarker(marker) {
   interested(marker.exists());
   interested(marker.name());
   interested(marker.position());
}

function init() {
   application = host.createApplication();
   arranger = host.createArranger();
   cueMarkerBank = arranger.createCueMarkerBank(MAX_CUE_MARKERS);
   project = host.getProject();
   transport = host.createTransport();
   trackBank = host.createMainTrackBank(MAX_TRACKS, 0, MAX_SCENES);
   sceneBank = trackBank.sceneBank();
   interested(sceneBank.itemCount());
   interested(sceneBank.scrollPosition());
   cursorTrack = host.createCursorTrack("CONTROL_DECK_TRACK_CURSOR", "Control Deck Track Cursor", 0, MAX_SCENES, true);
   cursorDevice = cursorTrack.createCursorDevice();
   cursorDeviceSlot = cursorDevice.getCursorSlot();
   cursorRemoteControlsPage = cursorDevice.createCursorRemoteControlsPage(8);
   nestedDeviceBank = cursorDeviceSlot.createDeviceBank(MAX_DEVICES);
   deviceBank = cursorTrack.createDeviceBank(MAX_DEVICES);
   launcherClip = host.createLauncherCursorClip(CLIP_GRID_WIDTH, CLIP_GRID_HEIGHT);
   launcherClip.addNoteStepObserver(onLauncherNoteStep);

   interested(application.projectName());
   interested(arranger.areCueMarkersVisible());
   interested(cueMarkerBank.itemCount());
   interested(project.isModified());
   interested(trackBank.itemCount());
   interested(trackBank.scrollPosition());
   interested(cursorTrack.exists());
   interested(cursorTrack.name());
   interested(cursorTrack.position());
   interested(deviceBank.itemCount());
   interested(deviceBank.scrollPosition());
   interested(nestedDeviceBank.itemCount());
   interested(nestedDeviceBank.scrollPosition());
   interested(cursorDevice.exists());
   interested(cursorDevice.name());
   interested(cursorDevice.deviceType());
   interested(cursorDevice.position());
   interested(cursorDevice.isNested());
   interested(cursorDevice.isPlugin());
   interested(cursorDevice.isEnabled());
   interested(cursorDevice.isWindowOpen());
   interested(cursorDevice.presetName());
   interested(cursorDevice.sampleName());
   interested(cursorDevice.hasSlots());
   interested(cursorDevice.slotNames());
   interested(cursorDeviceSlot.exists());
   interested(cursorDeviceSlot.name());
   interested(cursorDevice.isExpanded());
   interested(cursorDevice.isRemoteControlsSectionVisible());
   interested(cursorDevice.isParameterPageSectionVisible());
   interested(cursorRemoteControlsPage.getName());
   interested(cursorRemoteControlsPage.pageNames());
   interested(cursorRemoteControlsPage.selectedPageIndex());
   interested(cursorRemoteControlsPage.pageCount());
   for (var remoteIndex = 0; remoteIndex < 8; remoteIndex++) {
      var remoteControl = cursorRemoteControlsPage.getParameter(remoteIndex);
      interested(remoteControl.exists());
      interested(remoteControl.name());
      interested(remoteControl);
      interested(remoteControl.displayedValue());
   }
   interested(launcherClip.exists());
   interested(launcherClip.getLoopStart());
   interested(launcherClip.getLoopLength());
   interested(launcherClip.getPlayStart());
   interested(launcherClip.getPlayStop());
   interested(launcherClip.isLoopEnabled());

   interested(transport.isPlaying());
   interested(transport.isArrangerRecordEnabled());
   interested(transport.isArrangerLoopEnabled());
   interested(transport.isArrangerOverdubEnabled());
   interested(transport.isClipLauncherOverdubEnabled());
   interested(transport.tempo().value());
   interested(transport.tempo().value().displayedValue());
   interested(transport.getPosition());
   interested(application.hasActiveEngine());

   for (var i = 0; i < MAX_TRACKS; i++) {
      var markedTrack = trackBank.getItemAt(i);
      markTrack(markedTrack);
      trackIsCursor[i] = markedTrack.createEqualsValue(cursorTrack);
      interested(trackIsCursor[i]);
      observeTrackMeter(markedTrack, i);
      for (var s = 0; s < MAX_SCENES; s++) markSlot(markedTrack.clipLauncherSlotBank().getItemAt(s));
   }
   for (var j = 0; j < MAX_DEVICES; j++) markDevice(deviceBank.getItemAt(j));
   for (var nestedIndex = 0; nestedIndex < MAX_DEVICES; nestedIndex++) markDevice(nestedDeviceBank.getItemAt(nestedIndex));
   for (var cueMarkerIndex = 0; cueMarkerIndex < MAX_CUE_MARKERS; cueMarkerIndex++) {
      markCueMarker(cueMarkerBank.getItemAt(cueMarkerIndex));
   }

   cursorDevice.addDirectParameterIdObserver(function(ids) {
      directIds = arrayCopy(ids);
      directNames = {};
      directValues = {};
      directDisplays = {};
      // Display strings are opt-in in Bitwig's Controller API. Observing the
      // current device's IDs lets Control Deck verify enumerated routing parameters
      // (for example a HW Instrument MIDI output) by their visible names.
      directDisplayObserver.setObservedParameterIds(directIds);
   });
   cursorDevice.addDirectParameterNameObserver(256, function(id, name) {
      directNames[String(id)] = String(name);
   });
   cursorDevice.addDirectParameterNormalizedValueObserver(function(id, value) {
      directValues[String(id)] = Number(value);
   });
   directDisplayObserver = cursorDevice.addDirectParameterValueDisplayObserver(256, function(id, value) {
      directDisplays[String(id)] = String(value);
   });
   saveToLibraryAction = application.getAction("add_to_library");
   jumpToBeginningAction = application.getAction("jump_to_beginning_of_arrangement");
   popupBrowser = host.createPopupBrowser();
   resultColumn = popupBrowser.resultsColumn();
   resultBank = resultColumn.createItemBank(BROWSER_PAGE);
   deviceTypeBank = popupBrowser.deviceTypeColumn().createItemBank(64);
   categoryBank = popupBrowser.categoryColumn().createItemBank(64);
   tagBank = popupBrowser.tagColumn().createItemBank(64);
   fileTypeBank = popupBrowser.fileTypeColumn().createItemBank(64);
   creatorBank = popupBrowser.creatorColumn().createItemBank(128);

   interested(popupBrowser.exists());
   interested(popupBrowser.contentTypeNames());
   interested(popupBrowser.selectedContentTypeIndex());
   interested(resultColumn.exists());
   interested(resultColumn.entryCount());
   interested(popupBrowser.deviceTypeColumn().exists());
   interested(popupBrowser.deviceTypeColumn().entryCount());
   interested(popupBrowser.categoryColumn().exists());
   interested(popupBrowser.categoryColumn().entryCount());
   interested(popupBrowser.tagColumn().exists());
   interested(popupBrowser.tagColumn().entryCount());
   interested(popupBrowser.fileTypeColumn().exists());
   interested(popupBrowser.fileTypeColumn().entryCount());
   interested(popupBrowser.creatorColumn().exists());
   interested(popupBrowser.creatorColumn().entryCount());
   interested(popupBrowser.smartCollectionColumn().exists());
   interested(popupBrowser.locationColumn().exists());
   interested(popupBrowser.deviceColumn().exists());
   interested(resultBank.itemCount());
   interested(resultBank.scrollPosition());
   interested(deviceTypeBank.itemCount());
   interested(deviceTypeBank.scrollPosition());
   interested(categoryBank.itemCount());
   interested(categoryBank.scrollPosition());
   interested(tagBank.itemCount());
   interested(tagBank.scrollPosition());
   interested(fileTypeBank.itemCount());
   interested(fileTypeBank.scrollPosition());
   interested(creatorBank.itemCount());
   interested(creatorBank.scrollPosition());
   interested(popupBrowser.deviceTypeColumn().getWildcardItem().isSelected());
   interested(popupBrowser.categoryColumn().getWildcardItem().isSelected());
   interested(popupBrowser.tagColumn().getWildcardItem().isSelected());
   interested(popupBrowser.fileTypeColumn().getWildcardItem().isSelected());
   interested(popupBrowser.creatorColumn().getWildcardItem().isSelected());
   interested(popupBrowser.smartCollectionColumn().getWildcardItem().isSelected());
   interested(popupBrowser.locationColumn().getWildcardItem().isSelected());
   interested(popupBrowser.deviceColumn().getWildcardItem().isSelected());
   for (var r = 0; r < BROWSER_PAGE; r++) markBrowserItem(resultBank.getItemAt(r));
   for (var t = 0; t < 64; t++) {
      markBrowserItem(deviceTypeBank.getItemAt(t));
      markBrowserItem(categoryBank.getItemAt(t));
      markBrowserItem(tagBank.getItemAt(t));
      markBrowserItem(fileTypeBank.getItemAt(t));
      markBrowserItem(creatorBank.getItemAt(t));
   }
   for (var c = 64; c < 128; c++) markBrowserItem(creatorBank.getItemAt(c));

   if (CONTROL_DECK_TOKEN === "__CONTROL_DECK" + "_TOKEN__") {
      host.showPopupNotification("Control Deck Bridge has no auth token. Run `npm run setup` and reinstall the controller script.");
      host.errorln("Control Deck Bridge refused to start: the auth token placeholder was never stamped. Run `npm run setup` in the project folder.");
      return;
   }

   var datagramBound = host.addDatagramPacketObserver("Control Deck Bridge", CONTROL_DECK_PORT, function(data) {
      var request = null;
      try {
         request = JSON.parse(decodeUtf8(data));
         var replyPort = Number(request.replyPort);
         if (!request || request.protocol !== CONTROL_DECK_PROTOCOL || !request.id || !request.method ||
             !isFinite(replyPort) || replyPort < 1024 || replyPort > 65535) {
            throw new Error("Malformed Control Deck packet");
         }
         if (request.token !== CONTROL_DECK_TOKEN) {
            respond(replyPort, request.id, false, { message: "Control Deck authentication failed." });
            return;
         }
         enqueue(replyPort, String(request.id), String(request.method), request.params || {}, request.timeoutMs);
      } catch (error) {
         host.println("Control Deck request error: " + error);
         if (request && request.id && request.replyPort) {
            respond(request.replyPort, request.id, false, { message: "Invalid Control Deck request: " + error });
         }
      }
   });
   if (!datagramBound) throw new Error("Control Deck could not bind UDP port " + CONTROL_DECK_PORT);
   host.showPopupNotification("Control Deck Bridge online");
   host.println("Control Deck Bridge " + CONTROL_DECK_VERSION + " listening on UDP " + CONTROL_DECK_PORT);
}

function flush() {}

function exit() {
   host.println("Control Deck Bridge offline");
}
