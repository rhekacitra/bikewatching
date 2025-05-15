import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';


console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1Ijoicmhla2FjbiIsImEiOiJjbWFvaDNzdW0wNWkwMmtvZnU5Y2k3ZGl2In0.lBJliaE_bea07Fm4RKl5Vg';

let timeFilter = -1;
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
  }

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}


function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
      ? trips // If no filter is applied (-1), return all trips
      : trips.filter((trip) => {
          // Convert trip start and end times to minutes since midnight
          const startedMinutes = minutesSinceMidnight(trip.started_at);
          const endedMinutes = minutesSinceMidnight(trip.ended_at);
  
          // Include trips that started or ended within 60 minutes of the selected time
          return (
            Math.abs(startedMinutes - timeFilter) <= 60 ||
            Math.abs(endedMinutes - timeFilter) <= 60
          );
        });
}

function computeStationTraffic(stations, trips) {
    // Compute departures
    const departures = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.start_station_id,
    );
  
    // Computed arrivals as you did in step 4.2
    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id,
    );
  
    // Update each station..
    return stations.map((station) => {
      let id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });
}

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/rhekacn/cmaoiatzk018k01rf2fw42vy0', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

map.on('load', async () => {
    const svg = d3.select('#map').select('svg');

    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });
    
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#E5FFCC',  // A bright green using hex code
            'line-width': 5,          // Thicker lines
            'line-opacity': 0.6       // Slightly less transparent
          }
      });

    let jsonData;
    let trips;
    let stations = [];

    try {
        const jsonurl = 'bluebikes-stations.json';
        const jsonData = await d3.json(jsonurl);

        const trafficcsv = 'bluebikes-traffic-2024-03.csv';
        // trips = await d3.csv(trafficcsv);

        trips = await d3.csv(
            'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            (trip) => {
              trip.started_at = new Date(trip.started_at);
              trip.ended_at = new Date(trip.ended_at);
              return trip;
            },
          );

        console.log('Loaded JSON Data:', jsonData); // Log to verify structure

        stations = computeStationTraffic(jsonData.data.stations, trips);

    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }

    // Reposition markers on map interactions
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends

    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    const departures = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.start_station_id,
    );
    
    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id,
    );
    
    // stations = stations.map((station) => {
    //     let id = station.short_name;

    //     // arrivals
    //     station.arrivals = arrivals.get(id) ?? 0;

    //     // departures
    //     station.departures = departures.get(id) ?? 0;

    //     // totalTraffic
    //     station.totalTraffic = station.arrivals + station.departures;

    //     return station;
    // });

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 10]);

    const circles = svg
        .selectAll('circle')
        .data(stations, (d) => d.short_name) // Use station short_name as the key
        .enter()
        .append('circle')
        .attr('r', d => radiusScale(d.totalTraffic) ) // Radius of the circle
        .attr('fill', '#ECE583') // Circle fill color
        .attr('stroke', 'white') // Circle border color
        .attr('stroke-width', 1) // Circle border thickness
        .attr('opacity', 0.8) // Circle opacity
        .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic))
        .each(function (d) {
            // Add <title> for browser tooltips
            d3.select(this)
              .append('title')
              .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });

    function updateTimeDisplay() {
            timeFilter = Number(timeSlider.value); // Get slider value
          
            if (timeFilter === -1) {
              selectedTime.textContent = ''; // Clear time display
              anyTimeLabel.style.display = 'inline'; // Show "(any time)"
            } else {
              selectedTime.textContent = formatTime(timeFilter); // Display formatted time
              anyTimeLabel.style.display = 'none'; // Hide "(any time)"
            }
          
            console.log("Current timeFilter:", timeFilter);
            // Call updateScatterPlot to reflect the changes on the map
            updateScatterPlot();
    }
      
    function updateScatterPlot() {
            console.log("Current timeFilter:", timeFilter);
            // Get only the trips that match the selected time filter
            const filteredTrips = filterTripsbyTime(trips, timeFilter);
          
            // Recompute station traffic based on the filtered trips
            const filteredStations = computeStationTraffic(stations, filteredTrips);

            if (timeFilter === -1) {
                radiusScale.range([0, 25]); // ✅ visibly smaller default scale
              } else {
                radiusScale.range([3, 50]); // ✅ dramatically larger filtered scale
              }
              
            // Update the scatterplot by adjusting the radius of circles
            circles
              .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
              .join('circle') // Ensure the data is bound correctly
              .attr('r', (d) => radiusScale(d.totalTraffic))
              .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic))
              ; // Update circle sizes
    }

    function updatePositions() {
            circles
                .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
                .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }
    
    updatePositions();
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay(); // Run once on load

    console.log("Enriched stations with traffic info:", stations);

});
