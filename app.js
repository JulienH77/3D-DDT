// Définition de la grille de projection Lambert-93 (EPSG:2154)
proj4.defs("EPSG:2154", "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

// Initialisation de MapLibre sur un espace de travail neutre (sans fond de carte)
const map = new maplibregl.Map({
    container: 'map',
    style: {
        "version": 8,
        "sources": {},
        "layers": [
            {
                "id": "blank-canvas",
                "type": "background",
                "paint": { "background-color": "#1e1e24" } // Fond gris sombre texturé
            }
        ]
    },
    center: [0, 0], // Position temporaire, sera écrasée par le calcul de l'emprise
    zoom: 1,
    pitch: 60,      // Inclinaison de la caméra pour l'effet relief 3D
    bearing: -20    // Orientation de départ
});

map.on('load', () => {
    // Ajout des outils de navigation de base (boussole, zoom, inclinaison clavier)
    map.addControl(new maplibregl.NavigationControl());
    
    // Lecture du fichier de navigation principal
    fetch('layers.json')
        .then(res => {
            if (!res.ok) throw new Error("Fichier layers.json introuvable.");
            return res.json();
        })
        .then(layersConfig => pipelineInitialisation(layersConfig))
        .catch(err => console.error("Échec du chargement de la configuration :", err));
});

// Parcourt et convertit les structures géométriques du GeoJSON (Polygones & MultiPolygones)
function reprojector(geometry) {
    if (!geometry) return;
    
    if (geometry.type === "Polygon") {
        geometry.coordinates = geometry.coordinates.map(ring => 
            ring.map(coord => proj4("EPSG:2154", "EPSG:4326", coord))
        );
    } else if (geometry.type === "MultiPolygon") {
        geometry.coordinates = geometry.coordinates.map(polygon => 
            polygon.map(ring => 
                ring.map(coord => proj4("EPSG:2154", "EPSG:4326", coord))
            )
        );
    }
}

function pipelineInitialisation(layers) {
    const navContainer = document.getElementById('navigation-bind');
    const tabPromesses = [];
    const empriseGlobale = new maplibregl.LngLatBounds();

    layers.forEach(layer => {
        // Chargement individuel de chaque fichier spécifié dans le layers.json
        const requete = fetch(layer.file)
            .then(res => {
                if (!res.ok) throw new Error(`Fichier ${layer.file} inaccessible.`);
                return res.json();
            })
            .then(geojson => {
                // Conversion de toutes les entités de l'étage vers le système WGS84
                geojson.features.forEach(feature => {
                    reprojector(feature.geometry);
                    
                    // Récupération des points pour le calcul de l'enveloppe du bâtiment
                    if (feature.geometry && feature.geometry.coordinates) {
                        let points = feature.geometry.type === 'Polygon' 
                            ? feature.geometry.coordinates[0] 
                            : feature.geometry.coordinates[0][0];
                        
                        points.forEach(pt => empriseGlobale.extend(pt));
                    }
                });

                // Enregistrement des données converties dans les sources de MapLibre
                map.addSource(layer.id, {
                    type: 'geojson',
                    data: geojson
                });

                // Génération de la couche d'extrusion 3D sur la base des altitudes du JSON
                map.addLayer({
                    'id': layer.id + '-extrusion',
                    'type': 'fill-extrusion',
                    'source': layer.id,
                    'layout': { 'visibility': 'visible' },
                    'paint': {
                        'fill-extrusion-color': layer.color || '#3388ff',
                        'fill-extrusion-base': layer.base_z,
                        'fill-extrusion-height': layer.height_z,
                        'fill-extrusion-opacity': 0.85
                    }
                });

                // Génération dynamique de l'interface graphique de contrôle
                const label = document.createElement('label');
                label.className = 'layer-toggle';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                
                checkbox.addEventListener('change', (e) => {
                    const etat = e.target.checked ? 'visible' : 'none';
                    map.setLayoutProperty(layer.id + '-extrusion', 'visibility', etat);
                });

                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(layer.name));
                navContainer.appendChild(label);
            })
            .catch(err => console.error(err));
        
        tabPromesses.push(requete);
    });

    // Dès que l'ensemble des couches est traité et converti, on ajuste la vue sur le bâtiment
    Promise.all(tabPromesses).then(() => {
        if (!empriseGlobale.isEmpty()) {
            map.fitBounds(empriseGlobale, {
                padding: 80,
                duration: 1200,
                animate: true
            });
        }
    });
}