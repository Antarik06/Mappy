// Initialize map 
    // This code is directly found in the leaflet js quick start
    const map = L.map('map').setView([20, 0], 2);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    let marker;
    let circle;
    let zoomed = false;
    let currentLatLng = null;
    let routeLine = null;

    // Watch user location continuosuly 
    navigator.geolocation.watchPosition(success, error, {
        enableHighAccuracy: true
    });
    // gives me access to 2 functions which i need to define 
    function success(pos) {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        currentLatLng = L.latLng(lat, lon);

        if (marker) map.removeLayer(marker); // if marke already there then remove it first then mark the next point 
        if (circle) map.removeLayer(circle); // same as marker for the circle

        marker = L.marker(currentLatLng).addTo(map);
        circle = L.circle(currentLatLng, { radius: accuracy }).addTo(map);

        // Centers only once in the absolute beggining
        if (!zoomed) {
            map.fitBounds(circle.getBounds());
            zoomed = true;
        }
    }

    function error(err) {
        if (err.code === 1) {
            alert("Please allow location access.");
        } else {
            alert("Unable to fetch location.");
        }
    }

    async function drawRoute(start, end) {
        const url =
            `https://graphhopper.com/api/1/route` +
            `?point=${start.lat},${start.lng}` +
            `&point=${end.lat},${end.lng}` +
            `&vehicle=foot` +
            `&points_encoded=true` +
            `&key=57d9d0f6-832c-4037-9721-35b7bf7bc81c`;

        
        const res = await fetch(url);
        //console.log("res",res);
        const data = await res.json();
        //console.log("data:",data);
        // the response which is comming , i need to convt it to json
        // that json response has an atribute called paths (also has hints, info)
        if (!data.paths || !data.paths.length) {
            alert("Route not found");
            return;
        }

        const encoded = data.paths[0].points;
        //paths itself has an atribute "0" which itself has an attribut points
        //console.log("encoded",encoded);
        // encoded is like a uique string : "c}oiCe{pzOSb@zBVVJ?A"
        
        const coords = polyline.decode(encoded);
        //coords is an array of arrays
        //***Array of [lat, lng] points*** , it gets that ferom that complex string btw :)
        //console.log("coords",coords);
        if (routeLine) {
            map.removeLayer(routeLine);
        }

        //polyline takes that coords and draws a line
        //conecting many tiny points
        //[lat1, lng1] → [lat2, lng2] → [lat3, lng3] →...
        routeLine = L.polyline(coords, {
            color: "blue",
            weight: 5
        }).addTo(map);

        
        map.fitBounds(routeLine.getBounds());
    }

    // Click to select destination
    map.on("click", function (e) {
        if (!currentLatLng) {
            alert("Waiting for your location...");
            return;
        }
        console.log("click e",e)
        drawRoute(currentLatLng, e.latlng);
    });

    async function searchLocation() {
    const place = document.getElementById("searchBox").value;

    if (!place) {
        alert("Please enter a location");
        return;
    }

    if (!currentLatLng) {
        alert("Waiting for your location...");
        return;
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${place}`;

    const res = await fetch(url);
    //console.log(res);
    const data = await res.json();
    //console.log(data);
    if (!data.length) {
        alert("Location not found");
        return;
    }
    // data[0] has a lot of informttion 
    // I previously forgot to do parseFloat which is wrong
    // bcz the data comes in string format 
    const destination = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
    };

    // fit the map properly to searched place
    map.setView(destination, 13);

    // Draw the route :)
    drawRoute(currentLatLng, destination);
}