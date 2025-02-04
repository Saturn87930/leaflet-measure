import '../scss/leaflet-measure.scss';

import template from 'lodash/template';

import units from './units';
import calc from './calc';
import * as dom from './dom';
import { selectOne as $ } from './dom';
import Symbology from './symbology';
import { numberFormat } from './utils';

import {
  controlTemplate,
  resultsTemplate,
  pointPopupTemplate,
  linePopupTemplate,
  areaPopupTemplate,
} from './templates';

const templateSettings = {
  imports: { numberFormat },
  interpolate: /{{([\s\S]+?)}}/g, // mustache
};
const controlTemplateCompiled = template(controlTemplate, templateSettings);
const resultsTemplateCompiled = template(resultsTemplate, templateSettings);
const pointPopupTemplateCompiled = template(pointPopupTemplate, templateSettings);
const linePopupTemplateCompiled = template(linePopupTemplate, templateSettings);
const areaPopupTemplateCompiled = template(areaPopupTemplate, templateSettings);

L.Control.Measure = L.Control.extend({
  _className: 'leaflet-control-measure',
  options: {
    units: {},
    position: 'topright',
    primaryLengthUnit: 'feet',
    secondaryLengthUnit: 'miles',
    primaryAreaUnit: 'acres',
    activeColor: '#ABE67E', // base color for map features while actively measuring
    completedColor: '#C8F2BE', // base color for permenant features generated from completed measure
    captureZIndex: 10000, // z-index of the marker used to capture measure events
    popupOptions: {
      // standard leaflet popup options http://leafletjs.com/reference-1.3.0.html#popup-option
      className: 'leaflet-measure-resultpopup',
      autoPanPadding: [10, 10],
    },
  },
  initialize: function (options) {
    L.setOptions(this, options);
    const { activeColor, completedColor } = this.options;
    this._symbols = new Symbology({ activeColor, completedColor });
    this.options.units = L.extend({}, units, this.options.units);
  },
  onAdd: function (map) {
    this._map = map;
    this._latlngs = [];
    this._initLayout();
    map.on('click', this._collapse, this);
    this._layer = L.layerGroup().addTo(map);
    return this._container;
  },
  onRemove: function (map) {
    map.off('click', this._collapse, this);
    map.removeLayer(this._layer);
  },
  _initLayout: function () {
    const className = this._className,
      container = (this._container = L.DomUtil.create('div', `${className} leaflet-bar`));

    container.innerHTML = controlTemplateCompiled({
      model: {
        className: className,
      },
    });

    // makes this work on IE touch devices by stopping it from firing a mouseout event when the touch is released
    container.setAttribute('aria-haspopup', true);
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const $toggle = (this.$toggle = $('.js-toggle', container)); // collapsed content
    this.$interaction = $('.js-interaction', container); // expanded content
    const $start = $('.js-start', container); // start button
    const $cancel = $('.js-cancel', container); // cancel button
    const $finish = $('.js-finish', container); // finish button
    this.$startPrompt = $('.js-startprompt', container); // full area with button to start measurment
    this.$measuringPrompt = $('.js-measuringprompt', container); // full area with all stuff for active measurement
    this.$startHelp = $('.js-starthelp', container); // "Start creating a measurement by adding points"
    this.$results = $('.js-results', container); // div with coordinate, linear, area results
    this.$measureTasks = $('.js-measuretasks', container); // active measure buttons container

    this._collapse();
    this._updateMeasureNotStarted();

    if (!L.Browser.android) {
      L.DomEvent.on(container, 'mouseenter', this._expand, this);
      L.DomEvent.on(container, 'mouseleave', this._collapse, this);
    }
    L.DomEvent.on($toggle, 'click', L.DomEvent.stop);
    if (L.Browser.touch) {
      L.DomEvent.on($toggle, 'click', this._expand, this);
    } else {
      L.DomEvent.on($toggle, 'focus', this._expand, this);
    }
    L.DomEvent.on($start, 'click', L.DomEvent.stop);
    L.DomEvent.on($start, 'click', this._startMeasure, this);
    L.DomEvent.on($cancel, 'click', L.DomEvent.stop);
    L.DomEvent.on($cancel, 'click', this._finishMeasure, this);
    L.DomEvent.on($finish, 'click', L.DomEvent.stop);
    L.DomEvent.on($finish, 'click', this._handleMeasureDoubleClick, this);
  },
  _expand: function () {
    dom.hide(this.$toggle);
    dom.show(this.$interaction);
  },
  _collapse: function () {
    if (!this._locked) {
      dom.hide(this.$interaction);
      dom.show(this.$toggle);
    }
  },
  // move between basic states:
  // measure not started, started/in progress but no points added, in progress and with points
  _updateMeasureNotStarted: function () {
    dom.hide(this.$startHelp);
    dom.hide(this.$results);
    dom.hide(this.$measureTasks);
    dom.hide(this.$measuringPrompt);
    dom.show(this.$startPrompt);
  },
  _updateMeasureStartedNoPoints: function () {
    dom.hide(this.$results);
    dom.show(this.$startHelp);
    dom.show(this.$measureTasks);
    dom.hide(this.$startPrompt);
    dom.show(this.$measuringPrompt);
  },
  _updateMeasureStartedWithPoints: function () {
    dom.hide(this.$startHelp);
    dom.show(this.$results);
    dom.show(this.$measureTasks);
    dom.hide(this.$startPrompt);
    dom.show(this.$measuringPrompt);
  },
  // get state vars and interface ready for measure
  _startMeasure: function () {
    this._locked = true;
    this._measureVertexes = L.featureGroup().addTo(this._layer);
    this._captureMarker = L.marker(this._map.getCenter(), {
      clickable: true,
      zIndexOffset: this.options.captureZIndex,
      opacity: 0,
    }).addTo(this._layer);
    this._setCaptureMarkerIcon();

    this._captureMarker
      .on('mouseout', this._handleMapMouseOut, this)
      .on('dblclick', this._handleMeasureDoubleClick, this)
      .on('click', this._handleMeasureClick, this);

    this._map
      .on('mousemove', this._handleMeasureMove, this)
      .on('mouseout', this._handleMapMouseOut, this)
      .on('move', this._centerCaptureMarker, this)
      .on('resize', this._setCaptureMarkerIcon, this);

    L.DomEvent.on(this._container, 'mouseenter', this._handleMapMouseOut, this);

    this._updateMeasureStartedNoPoints();

    this._map.fire('measurestart', null, false);
  },
  // return to state with no measure in progress, undo `this._startMeasure`
  _finishMeasure: function () {
    const model = L.extend({}, this._resultsModel, { points: this._latlngs });

    this._locked = false;

    L.DomEvent.off(this._container, 'mouseover', this._handleMapMouseOut, this);

    this._clearMeasure();

    this._captureMarker
      .off('mouseout', this._handleMapMouseOut, this)
      .off('dblclick', this._handleMeasureDoubleClick, this)
      .off('click', this._handleMeasureClick, this);

    this._map
      .off('mousemove', this._handleMeasureMove, this)
      .off('mouseout', this._handleMapMouseOut, this)
      .off('move', this._centerCaptureMarker, this)
      .off('resize', this._setCaptureMarkerIcon, this);

    this._layer.removeLayer(this._measureVertexes).removeLayer(this._captureMarker);
    this._measureVertexes = null;

    this._updateMeasureNotStarted();
    this._collapse();

    this._map.fire('measurefinish', model, false);
  },
  // clear all running measure data
  _clearMeasure: function () {
    this._latlngs = [];
    this._resultsModel = null;
    this._measureVertexes.clearLayers();
    if (this._measureDrag) {
      this._layer.removeLayer(this._measureDrag);
    }
    if (this._measureArea) {
      this._layer.removeLayer(this._measureArea);
    }
    if (this._measureBoundary) {
      this._layer.removeLayer(this._measureBoundary);
    }
    this._measureDrag = null;
    this._measureArea = null;
    this._measureBoundary = null;
  },
  // centers the event capture marker
  _centerCaptureMarker: function () {
    this._captureMarker.setLatLng(this._map.getCenter());
  },
  // set icon on the capture marker
  _setCaptureMarkerIcon: function () {
    this._captureMarker.setIcon(
      L.divIcon({
        iconSize: this._map.getSize().multiplyBy(2),
      }),
    );
  },
  // format measurements to nice display string based on units in options
  // `{ lengthDisplay: '100 Feet (0.02 Miles)', areaDisplay: ... }`
  _getMeasurementDisplayStrings: function (measurement) {
    const unitDefinitions = this.options.units;

    return {
      lengthDisplay: buildDisplay(
        measurement.length,
        this.options.primaryLengthUnit,
        this.options.secondaryLengthUnit,
        this.options.decPoint,
        this.options.thousandsSep,
      ),
      areaDisplay: buildDisplay(
        measurement.area,
        this.options.primaryAreaUnit,
        this.options.secondaryAreaUnit,
        this.options.decPoint,
        this.options.thousandsSep,
      ),
    };

    function buildDisplay(val, primaryUnit, secondaryUnit, decPoint, thousandsSep) {
      if (primaryUnit && unitDefinitions[primaryUnit]) {
        let display = formatMeasure(val, unitDefinitions[primaryUnit], decPoint, thousandsSep);
        if (secondaryUnit && unitDefinitions[secondaryUnit]) {
          const formatted = formatMeasure(
            val,
            unitDefinitions[secondaryUnit],
            decPoint,
            thousandsSep,
          );
          display = `${display} (${formatted})`;
        }
        return display;
      }
      return formatMeasure(val, null, decPoint, thousandsSep);
    }

    function formatMeasure(val, unit, decPoint, thousandsSep) {
      const unitDisplays = {
        acres: __('acres'),
        feet: __('feet'),
        kilometers: __('kilometers'),
        hectares: __('hectares'),
        meters: __('meters'),
        miles: __('miles'),
        sqfeet: __('sqfeet'),
        sqmeters: __('sqmeters'),
        sqmiles: __('sqmiles'),
        sqkilometers: __('sqkilometers'),
      };

      const u = L.extend({ factor: 1, decimals: 0 }, unit);
      const formattedNumber = numberFormat(
        val * u.factor,
        u.decimals,
        decPoint || __('decPoint'),
        thousandsSep || __('thousandsSep'),
      );
      const label = unitDisplays[u.display] || u.display;
      return [formattedNumber, label].join(' ');
    }
  },

  _buildLink: function (measurement) {
    //get the current url
    const location = window.location;
    // get the current zoom level
    var z = this._map.getZoom();
    // extract the current lat and lng from the provided measurement object
    var x = measurement.center.x;
    var y = measurement.center.y;
    // create the link
    var search = new URLSearchParams(location.search);
    search.set('z', z);
    search.set('x', +x.toFixed(6));
    search.set('y', +y.toFixed(6));
    var url = location.origin + location.pathname + '?' + search.toString();
    return url;
  },

  // _getlsd: function (measurement) {
  //   // generate a random id for the measurement label in the interface
  //   const lsd_id = Math.random().toString(36).substring(7);
  //   fetch('https://ats.production.cleargrid.7627.network/ats/at', {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       latitude: measurement.center.y,
  //       longitude: measurement.center.x,
  //       key: 'leaflet-measure',
  //     }),
  //   })
  //     .then((response) => {
  //       console.log(response);
  //       //if we got a 200 response, return the json otherwise raise an error
  //       return response.json();
  //     })
  //     .then((data) => {
  //       console.log(data);
  //       let legal = data.legal ? data.legal : data.Error;
  //       console.log(legal);
  //       const e = document.getElementById(`lsd_${lsd_id}`);
  //       if (e) {
  //         e.innerHTML = legal;
  //       }
  //     });
  //   return `<span class=lsd>LSD:&nbsp;<span id="lsd_${lsd_id}">Loading...</span></span>`;
  // },


  _getlsd: function (measurement) {
    // Generate a random id for the measurement label in the interface
    const lsd_id = Math.random().toString(36).substring(7);    
    // Construct the latitude and longitude string for the Google Elevation API
    const latlon = `${measurement.center.y},${measurement.center.x}`;    
    // Construct the URL for the Google Elevation API request
    const url = `https://seep.eu.org/https://maps.googleapis.com/maps/api/elevation/json?locations=${latlon}&key=`;
    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then((data) => {
        // console.log(data);        
        // Check if the elevation data is available
        let elevation = 'Elevation data not available';
        if (data.results && data.results.length > 0) {
          elevation = `${data.results[0].elevation.toFixed(2)}米`;
        }

        const e = document.getElementById(`lsd_${lsd_id}`);
        if (e) {
          e.innerHTML = elevation;
        }
      })
      .catch((error) => {
        // console.error('There was a problem with the fetch operation:', error);
        const e = document.getElementById(`lsd_${lsd_id}`);
        if (e) {
          e.innerHTML = 'Error fetching elevation data';
        }
      });
    return `<span class="lsd">高程:&nbsp;<span id="lsd_${lsd_id}">加载中...</span></span>`;
  },


  // update results area of dom with calced measure from `this._latlngs`
  _updateResults: function () {
    const calced = calc(this._latlngs);
    const model = (this._resultsModel = L.extend(
      {},
      calced,
      this._getMeasurementDisplayStrings(calced),
      {
        pointCount: this._latlngs.length,
        link: this._buildLink(calced),
        lsd: this._getlsd(calced),
      },
    ));
    this.$results.innerHTML = resultsTemplateCompiled({ model });
  },
  // mouse move handler while measure in progress
  // adds floating measure marker under cursor
  _handleMeasureMove: function (evt) {
    if (!this._measureDrag) {
      this._measureDrag = L.circleMarker(evt.latlng, this._symbols.getSymbol('measureDrag')).addTo(
        this._layer,
      );
    } else {
      this._measureDrag.setLatLng(evt.latlng);
    }
    this._measureDrag.bringToFront();
  },
  // handler for both double click and clicking finish button
  // do final calc and finish out current measure, clear dom and internal state, add permanent map features
  _handleMeasureDoubleClick: function () {
    const latlngs = this._latlngs;
    let resultFeature, popupContent;

    this._finishMeasure();

    if (!latlngs.length) {
      return;
    }

    if (latlngs.length > 2) {
      latlngs.push(latlngs[0]); // close path to get full perimeter measurement for areas
    }

    const calced = calc(latlngs);
    const model = L.extend({}, calc(latlngs), {
      link: this._buildLink(calced),
      lsd: this._getlsd(calced),
    });

    if (latlngs.length === 1) {
      resultFeature = L.circleMarker(latlngs[0], this._symbols.getSymbol('resultPoint'));
      popupContent = pointPopupTemplateCompiled({
        model: model,
      });
    } else if (latlngs.length === 2) {
      resultFeature = L.polyline(latlngs, this._symbols.getSymbol('resultLine'));
      popupContent = linePopupTemplateCompiled({
        model: L.extend({}, model, this._getMeasurementDisplayStrings(calced)),
      });
    } else {
      resultFeature = L.polygon(latlngs, this._symbols.getSymbol('resultArea'));
      popupContent = areaPopupTemplateCompiled({
        model: L.extend({}, model, this._getMeasurementDisplayStrings(calced)),
      });
    }

    const popupContainer = L.DomUtil.create('div', '');
    popupContainer.innerHTML = popupContent;

    const zoomLink = $('.js-zoomto', popupContainer);
    if (zoomLink) {
      L.DomEvent.on(zoomLink, 'click', L.DomEvent.stop);
      L.DomEvent.on(
        zoomLink,
        'click',
        function () {
          if (resultFeature.getBounds) {
            this._map.fitBounds(resultFeature.getBounds(), {
              padding: [20, 20],
              maxZoom: 17,
            });
          } else if (resultFeature.getLatLng) {
            this._map.panTo(resultFeature.getLatLng());
          }
        },
        this,
      );
    }

    const deleteLink = $('.js-deletemarkup', popupContainer);
    if (deleteLink) {
      L.DomEvent.on(deleteLink, 'click', L.DomEvent.stop);
      L.DomEvent.on(
        deleteLink,
        'click',
        function () {
          // TODO. maybe remove any event handlers on zoom and delete buttons?
          this._layer.removeLayer(resultFeature);
        },
        this,
      );
    }

    resultFeature.addTo(this._layer);
    resultFeature.bindPopup(popupContainer, this.options.popupOptions);
    if (resultFeature.getBounds) {
      resultFeature.openPopup(resultFeature.getBounds().getCenter());
    } else if (resultFeature.getLatLng) {
      resultFeature.openPopup(resultFeature.getLatLng());
    }
  },
  // handle map click during ongoing measurement
  // add new clicked point, update measure layers and results ui
  _handleMeasureClick: function (evt) {
    const latlng = this._map.mouseEventToLatLng(evt.originalEvent), // get actual latlng instead of the marker's latlng from originalEvent
      lastClick = this._latlngs[this._latlngs.length - 1],
      vertexSymbol = this._symbols.getSymbol('measureVertex');

    if (!lastClick || !latlng.equals(lastClick)) {
      // skip if same point as last click, happens on `dblclick`
      this._latlngs.push(latlng);
      this._addMeasureArea(this._latlngs);
      this._addMeasureBoundary(this._latlngs);

      this._measureVertexes.eachLayer(function (layer) {
        layer.setStyle(vertexSymbol);
        // reset all vertexes to non-active class - only last vertex is active
        // `layer.setStyle({ className: 'layer-measurevertex'})` doesn't work. https://github.com/leaflet/leaflet/issues/2662
        // set attribute on path directly
        if (layer._path) {
          layer._path.setAttribute('class', vertexSymbol.className);
        }
      });

      this._addNewVertex(latlng);

      if (this._measureBoundary) {
        this._measureBoundary.bringToFront();
      }
      this._measureVertexes.bringToFront();
    }

    this._updateResults();
    this._updateMeasureStartedWithPoints();
  },
  // handle map mouse out during ongoing measure
  // remove floating cursor vertex from map
  _handleMapMouseOut: function () {
    if (this._measureDrag) {
      this._layer.removeLayer(this._measureDrag);
      this._measureDrag = null;
    }
  },
  // add various measure graphics to map - vertex, area, boundary
  _addNewVertex: function (latlng) {
    L.circleMarker(latlng, this._symbols.getSymbol('measureVertexActive')).addTo(
      this._measureVertexes,
    );
  },
  _addMeasureArea: function (latlngs) {
    if (latlngs.length < 3) {
      if (this._measureArea) {
        this._layer.removeLayer(this._measureArea);
        this._measureArea = null;
      }
      return;
    }
    if (!this._measureArea) {
      this._measureArea = L.polygon(latlngs, this._symbols.getSymbol('measureArea')).addTo(
        this._layer,
      );
    } else {
      this._measureArea.setLatLngs(latlngs);
    }
  },
  _addMeasureBoundary: function (latlngs) {
    if (latlngs.length < 2) {
      if (this._measureBoundary) {
        this._layer.removeLayer(this._measureBoundary);
        this._measureBoundary = null;
      }
      return;
    }
    if (!this._measureBoundary) {
      this._measureBoundary = L.polyline(latlngs, this._symbols.getSymbol('measureBoundary')).addTo(
        this._layer,
      );
    } else {
      this._measureBoundary.setLatLngs(latlngs);
    }
  },
});

L.Map.mergeOptions({
  measureControl: false,
});

L.Map.addInitHook(function () {
  if (this.options.measureControl) {
    this.measureControl = new L.Control.Measure().addTo(this);
  }
});

L.control.measure = function (options) {
  return new L.Control.Measure(options);
};
