// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// D3 Elevation Chart Module
// This module contains all logic for our custom D3 elevation chart.
// It uses an HTML <foreignObject> to render the summary text,
// allowing for dynamic text wrapping and automatic margin adjustment.
let svg, chartGroup;
let x, y, xAxis, yAxis; // D3 scales and axes
let width, height; // Chart dimensions (dynamically calculated)
let useImperial = false;
let chartTargetDivId;
let totalWidth, totalHeight; // Container dimensions
let currentRealDistance = 0;
let currentRawData = [];
let currentSource = null;

let verticalLine, hoverOverlay;

// Responsive & Margin constants
const MARGIN_BOTTOM_NARROW = 65;
const MARGIN_BOTTOM_WIDE = 30;
const SUMMARY_PADDING_BOTTOM = 10; // Space between summary text and chart
const MIN_TOP_MARGIN = 10; // Minimum top margin even if text is empty

const margin = {
  right: 65,
  bottom: MARGIN_BOTTOM_WIDE,
  left: 55,
};

/**
 * Converts Leaflet data (L.latLng(lat, lng, alt)) into D3 format.
 * @param {Array<L.LatLng>} pointsWithElev - Array of Leaflet LatLng objects with altitude
 * @returns {Array<{distance: number, elevation: number, latlng: L.LatLng}>} Formatted data for D3
 */
function formatDataForD3(pointsWithElev) {
  let cumulativeDistance = 0;
  const formattedData = [];

  if (!pointsWithElev || pointsWithElev.length < 2) {
    return [];
  }

  formattedData.push({
    distance: 0,
    elevation: pointsWithElev[0].alt || 0,
    latlng: pointsWithElev[0],
  });

  for (let i = 1; i < pointsWithElev.length; i++) {
    const p1 = pointsWithElev[i - 1];
    const p2 = pointsWithElev[i];
    cumulativeDistance += p1.distanceTo(p2);

    formattedData.push({
      distance: cumulativeDistance,
      elevation: p2.alt || 0,
      latlng: p2,
    });
  }
  return formattedData;
}

/**
 * Calculates hiking time in minutes based on the Swiss hiking time formula.
 * Adapted from map.geo.admin.ch
 * @see https://github.com/geoadmin/web-mapviewer/blob/develop/packages/geoadmin-elevation-profile/src/utils.ts
 * @param {Array<{distance: number, elevation: number}>} points - Elevation profile data, sorted by distance
 * @returns {number} The total hiking time in minutes
 */
function calculateSwissHikingTime(points) {
  if (!points || points.length < 2) {
    return 0;
  }

  // Constants of the formula (Schweizmobil)
  const arrConstants = [
    14.271, 3.6991, 2.5922, -1.4384, 0.32105, 0.81542, -0.090261, -0.20757, 0.010192, 0.028588,
    -0.00057466, -0.0021842, 1.5176e-5, 8.6894e-5, -1.3584e-7, -1.4026e-6,
  ];

  const timeInMinutes = points
    .map((currentPoint, index, points) => {
      if (index < points.length - 1) {
        const nextPoint = points[index + 1];
        const distanceDelta = (nextPoint.distance || 0) - (currentPoint.distance || 0);
        if (!distanceDelta) {
          return 0;
        }
        const elevationDelta = (nextPoint.elevation || 0) - (currentPoint.elevation || 0);

        // Slope in 10ths (Schweizmobil formula) instead of % (official formula)
        const slope = (elevationDelta * 10.0) / distanceDelta;

        // Swiss hiking formula is used between -40% and +40% (Schweizmobil)
        let minutesPerKilometer = 0;
        if (slope > -4 && slope < 4) {
          arrConstants.forEach((constants, i) => {
            minutesPerKilometer += constants * Math.pow(slope, i);
          });
        } else if (slope > 0) {
          minutesPerKilometer = 17 * slope;
        } else {
          minutesPerKilometer = -9 * slope;
        }
        return (distanceDelta * minutesPerKilometer) / 1000;
      }
      return 0;
    })
    .reduce((a, b) => a + b);

  return Math.round(timeInMinutes);
}

/**
 * Formats minutes to hours and minutes.
 * Adapted from map.geo.admin.ch
 * @see https://github.com/geoadmin/web-mapviewer/blob/develop/packages/geoadmin-elevation-profile/src/utils.ts
 * @param {number} minutes - Total minutes
 * @returns {string} Formatted time (e.g., '20 h 30 min', '55 min', or '-')
 */
function formatHikingTime(minutes) {
  if (!minutes || isNaN(minutes)) {
    return "-";
  }
  let result = "";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    minutes = minutes - hours * 60;
    result += `${hours} h`;
    if (minutes > 0) {
      result += ` ${minutes} min`;
    }
  } else {
    result += `${minutes} min`;
  }
  return result;
}

/**
 * Updates the chart's bottom margin based on the container width.
 * @param {number} containerWidth - The current width of the target div
 */
function updateBottomMargin(containerWidth) {
  const isNarrow = containerWidth < BREAKPOINT_MOBILE;
  margin.bottom = isNarrow ? MARGIN_BOTTOM_NARROW : MARGIN_BOTTOM_WIDE;
}

/**
 * Measures the summary text and recalculates all chart dimensions.
 */
function updateChartLayout() {
  if (!svg || !chartTargetDivId) return;

  const targetDiv = document.getElementById(chartTargetDivId);
  if (!targetDiv) return;

  totalWidth = targetDiv.clientWidth;
  totalHeight = targetDiv.clientHeight;

  if (totalHeight === 0 || totalWidth === 0) return;

  updateBottomMargin(totalWidth);

  width = totalWidth - margin.left - margin.right;
  if (width < 0) width = 0;

  const summaryContainer = svg.select("#d3-summary-container");
  summaryContainer.attr("width", width);

  const summaryDiv = svg.select("#d3-summary-html").node();
  const summaryHeight = summaryDiv ? summaryDiv.getBoundingClientRect().height : 0;

  margin.top = Math.max(MIN_TOP_MARGIN, summaryHeight + SUMMARY_PADDING_BOTTOM);

  height = totalHeight - margin.top - margin.bottom;
  if (height < 0) height = 0;
  svg.attr("viewBox", `0 0 ${totalWidth} ${totalHeight}`);
  chartGroup.attr("transform", `translate(${margin.left}, ${margin.top})`);
  summaryContainer.attr("height", margin.top); // Make FO container fit content

  x.range([0, width]);
  y.range([height, 0]);

  yAxis.attr("transform", `translate(${width}, 0)`);
  xAxis.attr("transform", `translate(0, ${height})`);

  // Update the hover overlay to match the chart size
  if (hoverOverlay) {
    hoverOverlay.attr("width", width).attr("height", height);
  }
}

/**
 * Draws the chart area path and axes based on currentData.
 */
function redrawChartData() {
  if (currentRawData.length < 2) {
    drawEmptyAxes();
    return;
  }

  const maxDistance = currentRawData[currentRawData.length - 1].distance;
  const [minElev, maxElev] = d3.extent(currentRawData, (d) => d.elevation);

  x.domain([0, maxDistance]);
  y.domain([minElev, maxElev]);

  const areaGenerator = d3
    .area()
    .x((d) => x(d.distance))
    .y0(height)
    .y1((d) => y(d.elevation));

  const lineGenerator = d3
    .line()
    .x((d) => x(d.distance))
    .y((d) => y(d.elevation));

  chartGroup.select(".altitude-area").datum(currentRawData).attr("d", areaGenerator);
  chartGroup.select(".altitude-line").datum(currentRawData).attr("d", lineGenerator);
  const distanceFormatter = (meters) => formatDistance(meters);
  const elevationFormatter = (meters) => {
    const feet = meters * 3.28084;
    return useImperial ? `${Math.round(feet)} ft` : `${Math.round(meters)} m`;
  };

  const tickValues = [0, maxDistance / 2, maxDistance];
  xAxis.call(d3.axisBottom(x).tickValues(tickValues).tickFormat(distanceFormatter));
  xAxis.selectAll(".tick text").style("text-anchor", (d, i, nodes) => {
    if (i === 0) return "start";
    if (i === nodes.length - 1) return "end";
    return "middle";
  });

  const yTickValues = [minElev, (minElev + maxElev) / 2, maxElev];
  yAxis.call(d3.axisRight(y).tickValues(yTickValues).tickFormat(elevationFormatter));
  yAxis
    .selectAll(".tick text")
    .attr("dy", null)
    .style("dominant-baseline", (d) => {
      if (d === minElev) return "baseline";
      if (d === maxElev) return "hanging";
      return "middle";
    });
}

/**
 * Draws empty axes when no data is present.
 */
function drawEmptyAxes() {
  const elevationFormatter = (meters) => {
    const feet = meters * 3.28084;
    return useImperial ? `${Math.round(feet)} ft` : `${Math.round(meters)} m`;
  };
  xAxis.call(d3.axisBottom(x).ticks(0).tickFormat(""));
  yAxis.call(d3.axisRight(y).ticks(4).tickFormat(elevationFormatter));
  yAxis.selectAll("text").text("");
}

/**
 * Initializes the D3 chart. Called once from main.js on load.
 * @param {string} targetDivId - The ID of the div to draw in (e.g., "elevation-div")
 * @param {boolean} isImperial - The initial unit setting
 */
function createElevationChart(targetDivId, isImperial) {
  useImperial = isImperial;
  chartTargetDivId = targetDivId;
  const targetDiv = document.getElementById(targetDivId);

  // Clear any old content
  d3.select(targetDiv).html("");

  svg = d3
    .select(targetDiv)
    .append("svg")
    .attr("class", "d3-elevation-svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("preserveAspectRatio", "xMinYMin meet");

  svg
    .append("foreignObject")
    .attr("id", "d3-summary-container")
    .attr("x", margin.left)
    .attr("y", 0)
    .attr("width", 1)
    .attr("height", 1)
    .append("xhtml:div")
    .attr("id", "d3-summary-html")
    .style("color", "var(--text-color)")
    .style("font-size", "var(--font-size-12)")
    .style("line-height", "1.4")
    .style("text-align", "center")
    .style("width", "100%")
    .style("padding-top", "5px");

  chartGroup = svg.append("g").attr("class", "d3-chart-group");

  x = d3.scaleLinear();
  y = d3.scaleLinear();

  chartGroup.append("path").attr("class", "altitude-area");
  chartGroup.append("path").attr("class", "altitude-line");

  verticalLine = chartGroup
    .append("line")
    .attr("class", "elevation-hover-line")
    .style("stroke", "var(--text-color)")
    .style("stroke-width", 1)
    .style("display", "none")
    .style("pointer-events", "none");

  const hoverTooltipGroup = chartGroup
    .append("g")
    .attr("class", "elevation-hover-tooltip-group")
    .style("display", "none")
    .style("pointer-events", "none");

  hoverTooltipGroup.append("path").attr("class", "elevation-hover-tooltip-path");

  hoverTooltipGroup
    .append("text")
    .attr("class", "elevation-hover-tooltip-text")
    .attr("id", "tooltip-distance-text");

  hoverTooltipGroup
    .append("text")
    .attr("class", "elevation-hover-tooltip-text")
    .attr("id", "tooltip-elevation-text");

  xAxis = chartGroup.append("g").attr("class", "x axis");
  yAxis = chartGroup.append("g").attr("class", "y axis");

  hoverOverlay = chartGroup
    .append("rect")
    .attr("class", "elevation-hover-overlay")
    .attr("x", 0)
    .attr("y", 0)
    .style("fill", "none")
    .style("pointer-events", "all")
    .on("mousemove", onHoverMove)
    .on("touchmove", onHoverMove)
    .on("mouseout", onHoverEnd)
    .on("touchend", onHoverEnd);

  updateChartLayout();
  drawEmptyAxes();
  let debounceTimer;
  window.addEventListener("resize", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateChartLayout();
      redrawChartData();
    }, 100);
  });
}

/**
 * Draws the elevation profile on the chart.
 * This is the main function to call when data changes.
 * @param {Array<L.LatLng>} pointsWithElev - The raw data from fetchElevationForPath
 * @param {number} [realDistance] - The optional, true distance from the original path
 * @param {string} [source] - The source of elevation data ("file" or "api")
 */
function drawElevationProfile(pointsWithElev, realDistance, source) {
  currentRawData = formatDataForD3(pointsWithElev);
  if (currentRawData.length < 2) {
    clearElevationProfile();
    return;
  }

  currentRealDistance = realDistance || 0;
  currentSource = source;
  const calculatedMaxDistance =
    currentRawData.length > 0 ? currentRawData[currentRawData.length - 1].distance : 0;

  if (currentRealDistance > 0 && calculatedMaxDistance > 0) {
    const scaleFactor = currentRealDistance / calculatedMaxDistance;
    if (scaleFactor !== 1) {
      for (let i = 1; i < currentRawData.length; i++) {
        currentRawData[i].distance *= scaleFactor;
      }
    }
  }

  const [minElev, maxElev] = d3.extent(currentRawData, (d) => d.elevation);

  const ascent = d3.sum(currentRawData, (d, i) => {
    if (i === 0) return 0;
    const diff = d.elevation - currentRawData[i - 1].elevation;
    return diff > 0 ? diff : 0;
  });
  const descent = d3.sum(currentRawData, (d, i) => {
    if (i === 0) return 0;
    const diff = d.elevation - currentRawData[i - 1].elevation;
    return diff < 0 ? -diff : 0;
  });
  const hikingTimeMinutes = calculateSwissHikingTime(currentRawData);
  const hikingTimeFormatted = formatHikingTime(hikingTimeMinutes);

  const elevationFormatter = (meters) => {
    const feet = meters * 3.28084;
    return useImperial ? `${Math.round(feet)} ft` : `${Math.round(meters)} m`;
  };

  const summaryDiv = svg.select("#d3-summary-html");
  if (summaryDiv) {
    const itemStyle = "display: inline-block; white-space: nowrap; margin: 0 4px;";
    summaryDiv.html(
      `<span style="${itemStyle}">Ascent: ${elevationFormatter(ascent)}</span>` +
        `<span style="${itemStyle}">Descent: ${elevationFormatter(descent)}</span>` +
        `<span style="${itemStyle}">Highest point: ${elevationFormatter(maxElev)}</span>` +
        `<span style="${itemStyle}">Lowest point: ${elevationFormatter(minElev)}</span>` +
        `<span style="${itemStyle}">Hiking time: ${hikingTimeFormatted}</span>` +
        // Show add/remove buttons only when "prefer file elevation" is enabled (default)
        // and the path is not an active route (unsaved routes may change anytime).
        (source &&
        localStorage.getItem("preferFileElevation") !== "false" &&
        selectedElevationPath?.feature?.properties?.pathType !== "route"
          ? `<span style="${itemStyle}">Source: ${source}` +
            (source === "File"
              ? ` <span onclick="removeElevationFromPath()" title="Remove elevation data from path" class="material-symbols material-symbols-fill elevation-action-icon">cancel</span>`
              : ` <span onclick="addElevationToPath()" title="Add elevation data to path" class="material-symbols material-symbols-fill elevation-action-icon">add_circle</span>`) +
            `</span>`
          : source
            ? `<span style="${itemStyle}">Source: ${source}</span>`
            : ""),
    );
  }

  updateChartLayout();
  redrawChartData();
}

/**
 * Clears the elevation profile from the chart.
 */
function clearElevationProfile() {
  currentRawData = [];
  currentRealDistance = 0;
  currentSource = null;

  const summaryDiv = svg.select("#d3-summary-html");
  if (summaryDiv) {
    summaryDiv.html("");
  }

  chartGroup.select(".altitude-area").attr("d", null);
  chartGroup.select(".altitude-line").attr("d", null);

  if (verticalLine) verticalLine.style("display", "none");
  if (chartGroup) chartGroup.select(".elevation-hover-tooltip-group").style("display", "none");
  if (window.mapInteractions) window.mapInteractions.hideElevationMarker();

  updateChartLayout();
  drawEmptyAxes();
}

/**
 * Updates the chart's units and redraws.
 * @param {boolean} isImperial - Whether to use imperial units
 */
function updateElevationChartUnits(isImperial) {
  useImperial = isImperial;
  if (currentRawData.length > 0) {
    drawElevationProfile(
      currentRawData.map((d) => d.latlng),
      currentRealDistance,
      currentSource,
    );
  } else {
    updateChartLayout();
    drawEmptyAxes();
  }
}

/**
 * Handles mousemove and touchmove events on the chart overlay.
 * Finds the corresponding data point and shows the marker and line.
 * @param {Event} event - The mouse or touch event
 */
function onHoverMove(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!currentRawData || currentRawData.length === 0) return;

  let pointerX;
  if (event.touches && event.touches.length > 0) {
    const touch = event.touches[0];
    const [xCoord] = d3.pointer(touch, chartGroup.node());
    pointerX = xCoord;
  } else if (event.changedTouches && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    const [xCoord] = d3.pointer(touch, chartGroup.node());
    pointerX = xCoord;
  } else {
    const [xCoord] = d3.pointer(event, chartGroup.node());
    pointerX = xCoord;
  }

  const clampedPointerX = Math.max(0, Math.min(width, pointerX));
  const hoverDistance = x.invert(clampedPointerX);

  const bisector = d3.bisector((d) => d.distance).left;
  let index = bisector(currentRawData, hoverDistance, 1);

  const d0 = currentRawData[index - 1];
  const d1 = currentRawData[index];

  if (d0 && d1) {
    index = hoverDistance - d0.distance > d1.distance - hoverDistance ? index : index - 1;
  } else if (d0) {
    index = currentRawData.length - 1;
  } else {
    index = 0;
  }

  index = Math.max(0, Math.min(currentRawData.length - 1, index));

  const dataPoint = currentRawData[index];

  if (dataPoint) {
    const distanceText = `Distance: ${formatDistance(dataPoint.distance)}`;
    const elevationFormatter = (meters) => {
      const feet = meters * 3.28084;
      return useImperial ? `${Math.round(feet)} ft` : `${Math.round(meters)} m`;
    };
    const elevationText = `Elevation: ${elevationFormatter(dataPoint.elevation)}`;

    const textDist = chartGroup.select("#tooltip-distance-text").text(distanceText);
    const textElev = chartGroup.select("#tooltip-elevation-text").text(elevationText);

    const distBBox = textDist.node().getBBox();
    const elevBBox = textElev.node().getBBox();
    const textWidth = Math.max(distBBox.width, elevBBox.width);

    const singleLineHeight = 12;

    const padding = 5;
    const flagWidth = textWidth + 2 * padding;
    const flagHeight = singleLineHeight * 2 + 2 * padding;
    const textY1 = padding + singleLineHeight - 2;
    const textY2 = textY1 + singleLineHeight + 2;
    let textX = padding;
    let flagPathD = "";
    const lineX = x(dataPoint.distance);
    let groupTransformX = lineX;
    const groupTransformY = 0;

    const pointsRight = lineX < width / 2;

    if (pointsRight) {
      textX = padding;
      groupTransformX = lineX;
      flagPathD = [
        `M 0,0`, // Top-left (at lineX)
        `h ${flagWidth}`, // Top-right
        `v ${flagHeight}`, // Bottom-right
        `h ${-flagWidth}`, // Bottom-left
        `Z`, // Close
      ].join(" ");
    } else {
      // Flag points left from the line
      textX = -flagWidth + padding;
      groupTransformX = lineX;

      // Draw rectangle extending left from the line
      flagPathD = [
        `M 0,0`, // Top-right (at lineX)
        `h ${-flagWidth}`, // Top-left
        `v ${flagHeight}`, // Bottom-left
        `h ${flagWidth}`, // Bottom-right
        `Z`, // Close
      ].join(" ");
    }

    // Apply updates to D3 elements
    const tooltip = chartGroup.select(".elevation-hover-tooltip-group");

    tooltip
      .attr("transform", `translate(${groupTransformX}, ${groupTransformY})`)
      .style("display", "block");

    tooltip.select(".elevation-hover-tooltip-path").attr("d", flagPathD);

    // Position text (Elevation first, then Distance)
    textElev.attr("x", textX).attr("y", textY1);
    textDist.attr("x", textX).attr("y", textY2);

    // Update the vertical line's position
    verticalLine
      .attr("x1", lineX)
      .attr("x2", lineX)
      .attr("y1", 0)
      .attr("y2", height)
      .style("display", "block");

    if (window.mapInteractions) {
      window.mapInteractions.showElevationMarker(dataPoint.latlng);
    }
  } else {
    console.warn("Could not find dataPoint in onHoverMove");
    onHoverEnd();
  }
}

/**
 * Handles mouseout and touchend events leaving the overlay rectangle.
 * Hides the marker and the vertical line.
 */
function onHoverEnd() {
  if (verticalLine) {
    verticalLine.style("display", "none");
  }

  if (chartGroup) {
    chartGroup.select(".elevation-hover-tooltip-group").style("display", "none");
  }

  if (window.mapInteractions) {
    window.mapInteractions.hideElevationMarker();
  }
}
window.elevationProfile = {
  createElevationChart,
  drawElevationProfile,
  clearElevationProfile,
  updateElevationChartUnits,
};
