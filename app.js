// Playdate: find a spot that is fair for two people, by car or by public transit.
// Runs entirely in the browser against free, open map services, so the same files
// work inside the workspace and as a standalone public website.

const SERVICES = {
  search: "https://nominatim.openstreetmap.org/search",
  reverse: "https://nominatim.openstreetmap.org/reverse",
  driveTable: "https://router.project-osrm.org/table/v1/driving/",
  transitFromOne: "https://api.transitous.org/api/v1/one-to-all",
  wikidata: "https://query.wikidata.org/sparql",
  wikipedia: "https://en.wikipedia.org/w/api.php",
  // OpenStreetMap's place search runs on volunteer servers that are often busy; try each in turn.
  overpass: [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ],
};

// The kinds of place that make a good hangout, as Wikidata knows them. The bonus is
// how many minutes of extra travel each kind is worth over a plain point on a map.
const SPOT_KINDS = {
  Q11315: { label: "Shopping centre", bonus: 4 },
  Q330284: { label: "Market", bonus: 4 },
  Q174782: { label: "Plaza", bonus: 4 },
  Q863454: { label: "Waterfront", bonus: 3 },
  Q123705: { label: "Neighbourhood", bonus: 2 },
  Q22698: { label: "Park", bonus: 1 },
};
const MAX_WALK_TO_STOP_M = 800;
const WALK_M_PER_MIN = 75;
const COLORS = { you: "#5aaee8", friend: "#ff9466" }; // figures and route lines: blue for you, peach for your friend
const AREA_COUNT = 3;
const AREA_SEPARATION_M = 1200; // two suggested spots are at least this far apart
const MAX_SNAP_M = 400; // a driving sample further than this from a road is in water or a park

// ---------- the animal friends ----------

const INK = "#6b5545"; // warm brown for faces and outlines

// Stick figures: a round head and thick limbs with a soft brown outline. You are blue, your friend is peach.
const POSES = {
  wave:  { head: [50, 20], lines: [[50,34,50,62],[50,40,28,24],[50,40,72,50],[50,62,34,90],[50,62,68,88]] },
  jump:  { head: [50, 20], lines: [[50,34,50,60],[50,40,26,18],[50,40,74,18],[50,60,30,80],[50,60,70,80]] },
  dance: { head: [46, 20], lines: [[48,34,54,60],[50,40,74,28],[50,40,26,54],[54,60,30,84],[54,60,74,90]] },
};

function figure(color, pose = "wave", size = 40, flip = false, motion = false) {
  const p = POSES[pose];
  const seg = (w, c) => p.lines.map(([a, b, c2, d]) =>
    `<line x1="${a}" y1="${b}" x2="${c2}" y2="${d}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`).join("");
  const rays = motion
    ? [[p.head[0] - 20, 6, p.head[0] - 26, 0], [p.head[0], 0, p.head[0], -6], [p.head[0] + 20, 6, p.head[0] + 26, 0]]
      .map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${color}" stroke-width="4.5" stroke-linecap="round"/>`).join("")
    : "";
  return `<svg width="${size}" height="${size}" viewBox="-4 -10 108 108" style="${flip ? "transform:scaleX(-1)" : ""};overflow:visible" aria-hidden="true">
    ${rays}${seg(18, INK)}<circle cx="${p.head[0]}" cy="${p.head[1]}" r="13.5" fill="${INK}"/>
    ${seg(11, color)}<circle cx="${p.head[0]}" cy="${p.head[1]}" r="10" fill="${color}"/></svg>`;
}

const you = (size, pose = "wave", motion = false) => figure(COLORS.you, pose, size, false, motion);
const pal = (size, pose = "wave", motion = false) => figure(COLORS.friend, pose, size, true, motion);

// A round pin with a heart in it: where the two friends meet.
function meetPin(size = 44) {
  return `<svg width="${size}" height="${size * 1.2}" viewBox="0 0 100 120" aria-hidden="true">
    <ellipse cx="50" cy="114" rx="16" ry="4.5" fill="#000" opacity=".12"/>
    <path d="M50 112 C38 92 12 76 12 48 a38 38 0 0 1 76 0 C88 76 62 92 50 112 Z" fill="#ff9fb6" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="50" cy="47" r="25" fill="#fff"/>
    <path d="M50 60 C38 51 34 45 37 40 a7 7 0 0 1 13 -1 a7 7 0 0 1 13 1 c3 5 -1 11 -13 20 Z" fill="#ff7c9c"/>
  </svg>`;
}

const ICONS = {
  car: `<svg width="24" height="20" viewBox="0 0 48 40" aria-hidden="true"><path d="M6 26 l4-11 q2-5 8-5 h12 q6 0 8 5 l4 11 v6 q0 2-2 2 H8 q-2 0-2-2 Z" fill="#9fd4f5" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><rect x="14" y="14" width="20" height="8" rx="3" fill="#fff"/><circle cx="14" cy="33" r="5" fill="${INK}"/><circle cx="34" cy="33" r="5" fill="${INK}"/></svg>`,
  train: `<svg width="20" height="22" viewBox="0 0 40 44" aria-hidden="true"><rect x="6" y="3" width="28" height="30" rx="9" fill="#a8e2c4" stroke="${INK}" stroke-width="3"/><rect x="11" y="9" width="18" height="10" rx="3" fill="#fff"/><circle cx="14" cy="26" r="2.5" fill="${INK}"/><circle cx="26" cy="26" r="2.5" fill="${INK}"/><path d="M12 41 l4-7 M28 41 l-4-7" stroke="${INK}" stroke-width="3" stroke-linecap="round"/></svg>`,
};

const bobbing = (html, second) => `<span class="bob ${second ? "b2" : ""}">${html}</span>`;

document.getElementById("fig-you").innerHTML = you(36);
document.getElementById("fig-friend").innerHTML = pal(36);
document.getElementById("hero-art").innerHTML = bobbing(you(54, "dance", true)) + `<span class="hero-heart">${meetPin(26)}</span>` + bobbing(pal(54, "jump", true), true);
const modeButtons = document.querySelectorAll("#modes button");
modeButtons[0].insertAdjacentHTML("afterbegin", ICONS.car);
modeButtons[1].insertAdjacentHTML("afterbegin", ICONS.train);

// ---------- small helpers ----------

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

function metersBetween([lat1, lng1], [lat2, lng2]) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

class UserFacingError extends Error {}

async function getJson(url, what) {
  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new UserFacingError(`Couldn't reach the ${what} service. Check your connection and try again.`);
  }
  if (!response.ok) throw new UserFacingError(`The ${what} service is busy right now (error ${response.status}). Try again in a minute.`);
  return response.json();
}

// Nominatim allows one request a second; space our calls out.
let lastNominatim = 0;
async function nominatim(url) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatim = Date.now();
  return getJson(url, "address lookup");
}

async function geocode(query, near) {
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", addressdetails: "1" });
  if (near) {
    // Prefer matches near the other person, so "Main St" finds the nearby one.
    const [lat, lng] = near, d = 1.5;
    params.set("viewbox", [lng - d, lat + d, lng + d, lat - d].join(","));
  }
  const rows = await nominatim(`${SERVICES.search}?${params}`);
  if (!rows.length) throw new UserFacingError(`Couldn't find "${query}". Try adding a city or zip code.`);
  return { pos: [+rows[0].lat, +rows[0].lon], label: rows[0].display_name };
}

async function placeName(pos) {
  const params = new URLSearchParams({ lat: pos[0], lon: pos[1], format: "jsonv2", zoom: "17", addressdetails: "1" });
  try {
    const j = await nominatim(`${SERVICES.reverse}?${params}`);
    const a = j.address || {};
    const area = a.neighbourhood || a.quarter || a.suburb || a.city_district || a.town || a.village || a.city || "";
    const town = a.city || a.town || a.village || "";
    return { street: a.road || a.pedestrian || "", area, town, label: j.display_name || "" };
  } catch (e) {
    return { street: "", area: "", town: "", label: "" };
  }
}

// ---------- the fair-middle math ----------

// Sample points in a band around the straight line between the two people,
// covering the middle 70% of the way and spreading a little to each side.
function samplePoints(a, b, along, across) {
  const cos = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  const ax = a[1] * cos, ay = a[0], bx = b[1] * cos, by = b[0];
  const dx = bx - ax, dy = by - ay;
  const pts = [];
  for (const f of along) {
    for (const o of across) {
      const x = ax + dx * f - dy * o, y = ay + dy * f + dx * o;
      pts.push([y, x / cos]);
    }
  }
  return pts;
}

async function driveTimes(you, friend, points) {
  const coords = [you, friend, ...points].map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
  const destinations = points.map((_, i) => i + 2).join(";");
  const j = await getJson(`${SERVICES.driveTable}${coords}?sources=0;1&destinations=${destinations}&annotations=duration`, "driving time");
  if (j.code !== "Ok") throw new UserFacingError("Couldn't work out driving times between these places. Are they connected by road?");
  const out = [];
  j.destinations.forEach((d, i) => {
    const tYou = j.durations[0][i], tFriend = j.durations[1][i];
    if (tYou == null || tFriend == null || d.distance > MAX_SNAP_M) return;
    out.push({ pos: [d.location[1], d.location[0]], you: tYou / 60, friend: tFriend / 60, raw: { snappedTo: d.name, sample: points[i] } });
  });
  return out;
}

async function findDriving(you, friend) {
  const along = [0.15, 0.25, 0.35, 0.45, 0.5, 0.55, 0.65, 0.75, 0.85];
  const across = [-0.3, -0.15, 0, 0.15, 0.3];
  const first = await driveTimes(you, friend, samplePoints(you, friend, along, across));
  if (!first.length) throw new UserFacingError("Couldn't find any roads between you two.");
  // Look more closely around the fairest few spots from the first pass.
  const best = [...first].sort((p, q) => score(p) - score(q)).slice(0, 3);
  const span = metersBetween(you, friend);
  const near = [];
  for (const c of best) {
    const d = Math.min(0.012, (span * 0.05) / 111000);
    for (const [dy, dx] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      near.push([c.pos[0] + dy * d, c.pos[1] + dx * d]);
    }
  }
  const second = await driveTimes(you, friend, near);
  return [...first, ...second];
}

async function findTransit(you, friend) {
  const fromOne = (p) => getJson(`${SERVICES.transitFromOne}?one=${p[0]},${p[1]}&maxTravelTime=120`, "public transit");
  const [a, b] = await Promise.all([fromOne(you), fromOne(friend)]);
  const friendTimes = new Map(b.all.map((x) => [x.place.stopId, x]));
  const out = [];
  for (const x of a.all) {
    const y = friendTimes.get(x.place.stopId);
    if (!y) continue;
    out.push({ pos: [x.place.lat, x.place.lon], you: x.duration, friend: y.duration, stop: x.place.name,
      importance: x.place.importance || 0, raw: { you: x, friend: y } });
  }
  if (!out.length) throw new UserFacingError("No public transit route reaches you both within two hours. Try driving instead.");
  return out;
}

// Lower is better: the longer trip counts most, and a lopsided split costs extra.
function score(c) {
  return Math.max(c.you, c.friend) + 0.5 * Math.abs(c.you - c.friend);
}

// Keep the best spot, then the best spot that is not right next to it, and so on.
function pickAreas(candidates) {
  const sorted = [...candidates].sort((p, q) => score(p) - score(q) || (q.importance || 0) - (p.importance || 0));
  const areas = [];
  for (const c of sorted) {
    if (areas.every((a) => metersBetween(a.pos, c.pos) > AREA_SEPARATION_M)) areas.push(c);
    if (areas.length === AREA_COUNT) break;
  }
  return areas;
}


// ---------- hangout spots near the middle ----------

const US_STATES = new Set(["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"]);

// Wikidata's "located in" is sometimes a county or a whole state; show only something city-sized.
function cityName(name) {
  const city = name.replace(/ County$/, "");
  return US_STATES.has(city) || /^Q\d+$/.test(city) ? "" : city;
}

async function nearbySpots(center, radiusKm) {
  const kinds = Object.keys(SPOT_KINDS).map((q) => `wd:${q}`).join(" ");
  const query = `SELECT ?item ?itemLabel ?type ?loc ?links ?article ?inLabel WHERE {
    SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${center[1]} ${center[0]})"^^geo:wktLiteral .
      bd:serviceParam wikibase:radius "${radiusKm.toFixed(1)}" . }
    VALUES ?type { ${kinds} }
    ?item wdt:P31 ?type ; wikibase:sitelinks ?links .
    ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
    OPTIONAL { ?item wdt:P131 ?in . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 300`;
  const j = await getJson(`${SERVICES.wikidata}?format=json&query=${encodeURIComponent(query)}`, "places");
  const byName = new Map();
  for (const b of j.results.bindings) {
    // "Prescott, Oakland, California" reads as "Prescott"; the town is shown separately.
    const name = b.itemLabel.value.split(", ")[0];
    if (/^Q\d+$/.test(name)) continue; // no English name
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.loc.value);
    if (!m) continue;
    const kind = SPOT_KINDS[b.type.value.split("/").pop()];
    const spot = { name, kindLabel: kind.label, bonus: kind.bonus, pos: [+m[2], +m[1]], links: +b.links.value,
      article: b.article.value, town: cityName(b.inLabel ? b.inLabel.value : ""), raw: b };
    const seen = byName.get(name);
    if (!seen || seen.bonus < spot.bonus) byName.set(name, spot);
  }
  // Better-known places first; timing every one would be slow.
  return [...byName.values()].sort((a, b) => b.links - a.links).slice(0, 40);
}

async function timeSpotsByCar(spots, you, friend) {
  const timed = await driveTimes(you, friend, spots.map((s) => s.pos));
  // driveTimes drops points it could not reach; match the rest back by position.
  return spots.map((s) => {
    const t = timed.find((x) => x.raw.sample === s.pos);
    return t ? { ...s, you: t.you, friend: t.friend } : null;
  }).filter(Boolean);
}

function timeSpotsByTransit(spots, stops) {
  return spots.map((s) => {
    let best = null;
    for (const stop of stops) {
      const walk = metersBetween(s.pos, stop.pos);
      if (walk > MAX_WALK_TO_STOP_M) continue;
      const c = { you: stop.you + walk / WALK_M_PER_MIN, friend: stop.friend + walk / WALK_M_PER_MIN, stop: stop.stop };
      if (!best || score(c) < score(best)) best = c;
    }
    return best ? { ...s, ...best } : null;
  }).filter(Boolean);
}

// Fair comes first, but a well-known plaza a few minutes further beats an empty street corner.
function spotScore(s) {
  return score(s) - s.bonus - Math.min(s.links, 30) / 6;
}

function pickSpots(spots) {
  const sorted = [...spots].sort((a, b) => spotScore(a) - spotScore(b));
  const picked = [];
  for (const s of sorted) {
    if (picked.every((p) => metersBetween(p.pos, s.pos) > 800)) picked.push(s);
    if (picked.length === AREA_COUNT) break;
  }
  return picked;
}

async function addSummaries(spots) {
  const titles = spots.map((s) => decodeURIComponent(s.article.split("/wiki/")[1]).replace(/_/g, " "));
  const params = new URLSearchParams({ action: "query", format: "json", origin: "*", prop: "extracts", exintro: "1",
    explaintext: "1", exsentences: "2", exlimit: "max", redirects: "1", titles: titles.join("|") });
  try {
    // Wikipedia sometimes turns a request away for a moment; one retry usually gets through.
    const url = `${SERVICES.wikipedia}?${params}`;
    const j = await getJson(url, "Wikipedia").catch(() => sleep(1500).then(() => getJson(url, "Wikipedia")));
    const byTitle = new Map(Object.values(j.query.pages).map((p) => [p.title, p.extract]));
    const renamed = new Map((j.query.redirects || []).concat(j.query.normalized || []).map((r) => [r.from, r.to]));
    spots.forEach((s, i) => { s.summary = byTitle.get(renamed.get(titles[i]) || titles[i]) || ""; });
  } catch (e) {
    // The spots still work without their write-ups.
  }
}

// The worst a hangout spot may be against the fair point it replaces, in score minutes.
const MAX_SPOT_PENALTY = 8;
// A fair point on one of these is somewhere you drive through, not somewhere you meet.
const NOT_A_MEETING_PLACE = /highway|freeway|interstate|expressway|tunnel|bridge|skyway|ramp/i;

async function findSpots(candidates, mode) {
  const fairPoints = pickAreas(candidates);
  const spanKm = metersBetween(state.you.pos, state.friend.pos) / 1000;
  const radiusKm = Math.min(5, Math.max(1.5, spanKm * 0.1));
  // Look around each fair point at once; a failed look just means no spots there.
  const found = await Promise.all(fairPoints.map((p) => nearbySpots(p.pos, radiusKm).catch(() => [])));
  const unique = new Map();
  found.flat().forEach((s) => unique.set(s.name, s));
  let spots = [...unique.values()];
  if (spots.length) {
    renderBusy("Timing trips to each spot...");
    spots = mode === "drive"
      ? await timeSpotsByCar(spots.slice(0, 60), state.you.pos, state.friend.pos)
      : timeSpotsByTransit(spots, candidates);
  }
  // A known spot only wins if it is nearly as fair as the fairest point on the map.
  const fairest = Math.min(...fairPoints.map(score));
  const good = spots.filter((s) => score(s) <= fairest + MAX_SPOT_PENALTY);
  const picked = pickSpots(good).map((s) => ({ ...s, kind: s.kindLabel }));
  if (picked.length) {
    renderBusy("Reading up on each spot...");
    await addSummaries(picked);
  }
  // Top up with plain fair points that are not next to a spot already picked.
  for (const p of fairPoints) {
    if (picked.length >= AREA_COUNT) break;
    if (picked.some((s) => metersBetween(s.pos, p.pos) <= 800)) continue;
    renderBusy("Naming the spots...");
    const n = await placeName(p.pos);
    if (NOT_A_MEETING_PLACE.test(n.street) && picked.length) continue;
    picked.push({ ...p, name: [n.street, n.area].filter(Boolean).join(", ") || p.stop || "Meeting spot",
      kind: "Fair middle", near: mode === "transit" && p.stop ? `Near ${p.stop}` : "", town: n.town });
  }
  return picked;
}

// ---------- app state ----------

const state = {
  mode: "drive",
  you: { label: "", pos: null, fromDevice: false },
  friend: { label: "", pos: null },
  results: {}, // mode -> list of areas, for the current pair of addresses
  selected: 0,
  tab: "eat", // which list of places is showing: "eat" or "see"
  radiusM: 800,
  busy: false,
};

// ---------- map ----------

// Vector map tiles from OpenFreeMap (free, no key), in its standard light style.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const map = new maplibregl.Map({
  container: "map",
  style: MAP_STYLE,
  center: [-122.35, 37.79],
  zoom: 9.5,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

let mapReady = false;
const markers = [];

// Line dashes are measured in line widths, so the white outline and the colour on top
// get dash patterns scaled to their widths; round caps then make the outline show.
function dashFor(width, transit) {
  const [on, off] = transit ? [0.01, 14] : [18, 10];
  return [on / width, off / width];
}

map.on("load", () => {
  const empty = { type: "FeatureCollection", features: [] };
  map.addSource("area", { type: "geojson", data: empty });
  map.addSource("routes", { type: "geojson", data: empty });
  map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#9ee0c0", "fill-opacity": 0.32 } });
  map.addLayer({ id: "area-edge", type: "line", source: "area",
    paint: { "line-color": "#4fb58a", "line-width": 3.5, "line-dasharray": [2, 1.6] } });
  for (const who of ["you", "friend"]) {
    const filter = ["==", ["get", "who"], who];
    map.addLayer({ id: `route-${who}-edge`, type: "line", source: "routes", filter,
      layout: { "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 10 } });
    map.addLayer({ id: `route-${who}`, type: "line", source: "routes", filter,
      layout: { "line-cap": "round" }, paint: { "line-color": COLORS[who], "line-width": 6 } });
  }
  // Start with the map credits folded into the (i) button, so they don't cover the map on phones.
  document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  mapReady = true;
  drawMap();
});

const placeMarkers = new Map(); // "eat0" -> marker

function placePin(tab, n, hl) {
  return `<span class="pin ${tab} ${hl ? "hl" : ""}">${n}</span>`;
}

// Numbered pins for the places around the selected spot; the tab that is showing is drawn on top.
function drawPlaces() {
  placeMarkers.forEach((m) => m.remove());
  placeMarkers.clear();
  if (!mapReady) return;
  const area = state.results[state.mode]?.[state.selected];
  if (!area) return;
  const places = placesFor(area);
  for (const tab of state.tab === "eat" ? ["see", "eat"] : ["eat", "see"]) {
    places[tab].forEach((p, i) => {
      const el = document.createElement("div");
      el.className = `pin-wrap ${tab === state.tab ? "" : "faded"}`;
      el.innerHTML = placePin(tab, i + 1, false);
      el.addEventListener("mouseenter", () => highlightPlace(tab, i, true));
      el.addEventListener("mouseleave", () => highlightPlace(tab, i, false));
      const popup = new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
        `<div class="pop"><b>${esc(p.name)}</b><span>${esc(p.meta)}</span>
          <a href="${placeLink(p)}" target="_blank" rel="noopener">Open in Google Maps &#8599;</a>
          <a class="src" href="${esc(p.source)}" target="_blank" rel="noopener">Source: ${p.sourceName} &#8599;</a></div>`);
      placeMarkers.set(tab + i, new maplibregl.Marker({ element: el }).setLngLat([p.pos[1], p.pos[0]]).setPopup(popup).addTo(map));
    });
  }
}

function highlightPlace(tab, i, on) {
  placeMarkers.get(tab + i)?.getElement().querySelector(".pin")?.classList.toggle("hl", on);
  document.querySelector(`.place[data-key="${tab}${i}"]`)?.classList.toggle("hl", on);
}

function circlePolygon([lat, lng], radiusM) {
  const ring = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(t)) / 111320;
    const dLng = (radiusM * Math.sin(t)) / (111320 * Math.cos(lat * Math.PI / 180));
    ring.push([lng + dLng, lat + dLat]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

function addMarker(pos, html, className) {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = html;
  markers.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([pos[1], pos[0]]).addTo(map));
}

function personMarker(pos, name) {
  addMarker(pos, `${name === "You" ? you(52) : pal(52)}<span class="who">${name}</span>`, "person-marker");
}

function meetMarker(center) {
  addMarker(center, meetPin(44), "meet-marker");
}

function drawMap() {
  if (!mapReady) return;
  markers.splice(0).forEach((m) => m.remove());
  const areas = state.results[state.mode];
  const area = areas && areas[state.selected];
  const transit = state.mode === "transit";
  const routes = [];
  if (area) {
    for (const [who, p] of [["you", state.you.pos], ["friend", state.friend.pos]]) {
      routes.push({ type: "Feature", properties: { who },
        geometry: { type: "LineString", coordinates: [[p[1], p[0]], [area.pos[1], area.pos[0]]] } });
      map.setPaintProperty(`route-${who}-edge`, "line-dasharray", dashFor(10, transit));
      map.setPaintProperty(`route-${who}`, "line-dasharray", dashFor(6, transit));
    }
  }
  map.getSource("routes").setData({ type: "FeatureCollection", features: routes });
  map.getSource("area").setData({ type: "FeatureCollection", features: area ? [circlePolygon(area.pos, state.radiusM)] : [] });
  if (state.you.pos) personMarker(state.you.pos, "You");
  if (state.friend.pos) personMarker(state.friend.pos, "Friend");
  // Keep both people, their lines and the meeting circle in view. The figures stand above
  // their spot with a name tag under their feet, so leave room above and below.
  const pad = isPhone() ? { top: 70, bottom: 40, left: 36, right: 36 } : { top: 90, bottom: 60, left: 70, right: 70 };
  const points = [state.you.pos, state.friend.pos].filter(Boolean);
  if (area) {
    meetMarker(area.pos);
    const dLat = state.radiusM / 111320, dLng = state.radiusM / (111320 * Math.cos(area.pos[0] * Math.PI / 180));
    points.push([area.pos[0] - dLat, area.pos[1] - dLng], [area.pos[0] + dLat, area.pos[1] + dLng]);
  }
  drawPlaces();
  if (points.length > 1) {
    const lats = points.map((p) => p[0]), lngs = points.map((p) => p[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: pad, duration: 700, maxZoom: 15 });
  } else if (points.length === 1) {
    map.flyTo({ center: [points[0][1], points[0][0]], zoom: 13, duration: 700 });
  }
}

// ---------- list ----------

function directionsLink(from, to, mode) {
  const params = new URLSearchParams({ api: "1", origin: from.join(","), destination: to.join(","),
    travelmode: mode === "transit" ? "transit" : "driving" });
  return `https://www.google.com/maps/dir/?${params}`;
}

function placeQuery(a) {
  return a.article ? [a.name, a.town].filter(Boolean).join(", ") : a.pos.map((x) => x.toFixed(5)).join(",");
}

function googleMapsSearch(what, a) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${what} near ${placeQuery(a)}`)}`;
}

function googleSearch(what, a) {
  const where = a.article ? placeQuery(a) : [a.name, a.town].filter(Boolean).join(", ");
  return `https://www.google.com/search?q=${encodeURIComponent(`${what} near ${where}`)}`;
}

function renderStart() {
  $("results").innerHTML = `<div class="state">
    <div class="figs">${you(60)}${pal(60)}</div>
    <p class="big">Where are you two?</p>
    <p>Add both addresses and pick how you're getting there. We'll find spots that take you about the same time.</p></div>`;
}

function renderBusy(text) {
  $("results").innerHTML = `<div class="state">
    <div class="figs">${bobbing(you(60, "dance"))}${bobbing(pal(60, "jump"), true)}</div>
    <p class="big">${esc(text)}</p></div>`;
}

function renderError(message) {
  $("results").innerHTML = `<div class="state error">
    <div class="figs">${you(60, "jump")}</div>
    <p class="big">Hmm, that didn't work</p><p>${esc(message)}</p></div>`;
}

function renderList() {
  const areas = state.results[state.mode];
  if (!areas) return renderStart();
  $("results").innerHTML =
    `<div class="section-title">${state.mode === "drive" ? "Fairest spots by car" : "Fairest spots by transit"}</div>` +
    areas.map((a, idx) => {
      const you = Math.round(a.you), friend = Math.round(a.friend);
      const gap = Math.abs(you - friend), total = you + friend || 1;
      return `
      <div class="area ${idx === state.selected ? "on" : ""}" data-idx="${idx}">
        <div class="area-top"><span class="area-name">${esc(a.name)}</span>${a.kind ? `<span class="area-kind">${esc(a.kind)}</span>` : ""}</div>
        <div class="times"><span class="y">You <b>${you} min</b></span><span class="f">Friend <b>${friend} min</b></span>${a.town ? `<span class="town">${esc(a.town)}</span>` : ""}</div>
        <div class="balance"><span style="width:${you / total * 100}%;background:var(--you)"></span><span style="width:${friend / total * 100}%;background:var(--friend)"></span></div>
        <div class="fair ${idx === 0 ? "best" : ""}">${gap === 0 ? "Exactly even" : gap + " min apart"}${idx === 0 ? " &middot; best pick" : ""}</div>
        <div class="places">
          <div class="routes">
            <a href="${directionsLink(state.you.pos, a.pos, state.mode)}" target="_blank" rel="noopener">Your route &#8599;</a>
            <a href="${directionsLink(state.friend.pos, a.pos, state.mode)}" target="_blank" rel="noopener">Friend's route &#8599;</a>
          </div>
          ${a.near ? `<p class="near">${esc(a.near)}</p>` : ""}${a.summary ? `<p class="summary">${esc(a.summary)}</p>` : ""}
          ${idx === state.selected ? renderPlaces(a) : ""}
          <div class="explore">
            <span>More on Google:</span>
            <a class="btn eat" href="${googleMapsSearch("restaurants", a)}" target="_blank" rel="noopener">Places to eat &#8599;</a>
            <a class="btn see" href="${googleSearch("things to do", a)}" target="_blank" rel="noopener">Things to do &#8599;</a>
          </div>
          ${a.article ? `<a class="source" href="${esc(a.article)}" target="_blank" rel="noopener">About this place on Wikipedia &#8599;</a>` : ""}
          <div class="radius">Area size
            ${[400, 800, 1600].map((m) => `<button type="button" data-r="${m}" class="${m === state.radiusM ? "on" : ""}">${m < 1000 ? m + " m" : m / 1000 + " km"}</button>`).join("")}
          </div>
        </div>
      </div>`;
    }).join("") +
    `<div class="footnote">${state.mode === "drive"
      ? "Driving times assume normal traffic-free roads, so rush hour will run longer."
      : "Transit times are for leaving now and include walking to the stop."}</div>`;
}

// ---------- places to eat and things to do ----------

// Notable places, as Wikidata knows them: quick to fetch, but only well-known places are in it.
const WIKIDATA_PLACES = {
  Q11707: ["eat", "Restaurant"], Q30022: ["eat", "Café"], Q187456: ["eat", "Bar"], Q212198: ["eat", "Pub"], Q274393: ["eat", "Bakery"],
  Q33506: ["see", "Museum"], Q207694: ["see", "Art museum"], Q1007870: ["see", "Art gallery"], Q22698: ["see", "Park"],
  Q4989906: ["see", "Monument"], Q11315: ["see", "Shopping centre"], Q570116: ["see", "Attraction"], Q24354: ["see", "Theatre"],
  Q41253: ["see", "Cinema"], Q330284: ["see", "Market"], Q174782: ["see", "Plaza"], Q863454: ["see", "Pier"], Q7075: ["see", "Library"],
};

// Everyday places, as OpenStreetMap knows them: almost every restaurant and shop, but slow to fetch.
const OSM_KINDS = {
  amenity: { restaurant: ["eat", "Restaurant"], cafe: ["eat", "Café"], bar: ["eat", "Bar"], pub: ["eat", "Pub"], ice_cream: ["eat", "Ice cream"],
    food_court: ["eat", "Food court"], theatre: ["see", "Theatre"], cinema: ["see", "Cinema"], arts_centre: ["see", "Arts centre"],
    marketplace: ["see", "Market"] },
  shop: { bakery: ["eat", "Bakery"], deli: ["eat", "Deli"], chocolate: ["eat", "Chocolate shop"], cheese: ["eat", "Cheese shop"],
    mall: ["see", "Shopping centre"], books: ["see", "Bookshop"], department_store: ["see", "Department store"], gift: ["see", "Gift shop"],
    toys: ["see", "Toy shop"], music: ["see", "Record shop"], games: ["see", "Game shop"], art: ["see", "Art shop"], wine: ["see", "Wine shop"] },
  tourism: { attraction: ["see", "Attraction"], museum: ["see", "Museum"], gallery: ["see", "Art gallery"], viewpoint: ["see", "Viewpoint"],
    zoo: ["see", "Zoo"], aquarium: ["see", "Aquarium"], theme_park: ["see", "Theme park"] },
  leisure: { park: ["see", "Park"], garden: ["see", "Garden"] },
};
const PLACES_PER_TAB = 8;
const placesCache = new Map();

function placesKey(area) {
  return `${area.pos[0].toFixed(4)},${area.pos[1].toFixed(4)},${state.radiusM}`;
}

async function wikidataPlaces(center, radiusM) {
  const kinds = Object.keys(WIKIDATA_PLACES).map((q) => `wd:${q}`).join(" ");
  const query = `SELECT ?item ?itemLabel ?type ?loc ?links ?article WHERE {
    SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${center[1]} ${center[0]})"^^geo:wktLiteral .
      bd:serviceParam wikibase:radius "${(radiusM / 1000).toFixed(2)}" . }
    VALUES ?type { ${kinds} }
    ?item wdt:P31 ?type ; wikibase:sitelinks ?links .
    OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 200`;
  const j = await getJson(`${SERVICES.wikidata}?format=json&query=${encodeURIComponent(query)}`, "places");
  const out = [];
  for (const b of j.results.bindings) {
    const name = b.itemLabel.value;
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.loc.value);
    if (/^Q\d+$/.test(name) || !m) continue;
    const [tab, meta] = WIKIDATA_PLACES[b.type.value.split("/").pop()];
    out.push({ name: name.replace(/ \((restaurant|San Francisco|museum)\)$/i, ""), tab, meta, pos: [+m[2], +m[1]],
      rank: 100 + Math.min(+b.links.value, 40), source: b.article ? b.article.value : b.item.value,
      sourceName: b.article ? "Wikipedia" : "Wikidata", raw: b });
  }
  return out;
}

function osmQuery(center, radiusM) {
  const around = `(around:${Math.round(radiusM)},${center[0]},${center[1]})`;
  const clauses = Object.entries(OSM_KINDS).map(([key, values]) =>
    `nwr["${key}"~"^(${Object.keys(values).join("|")})$"]["name"]${around};`).join("");
  return `[out:json][timeout:20];(${clauses});out tags center 400;`;
}

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(timer); }
}

async function osmPlaces(center, radiusM) {
  const data = encodeURIComponent(osmQuery(center, radiusM));
  for (const server of SERVICES.overpass) {
    try {
      const r = await fetchWithTimeout(`${server}?data=${data}`, 25000);
      if (!r.ok) continue;
      const j = await r.json();
      return j.elements.map((e) => osmPlace(e, center, radiusM)).filter(Boolean);
    } catch (e) {
      // busy or unreachable: try the next server
    }
  }
  throw new UserFacingError("OpenStreetMap is busy right now.");
}

function osmPlace(e, center, radiusM) {
  const t = e.tags || {};
  let kind = null;
  for (const [key, values] of Object.entries(OSM_KINDS)) if (values[t[key]]) { kind = values[t[key]]; break; }
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (!kind || lat == null) return null;
  const [tab, label] = kind;
  const cuisine = t.cuisine ? t.cuisine.split(";").slice(0, 2).map((c) => c.replace(/_/g, " ")).join(", ") : "";
  const meta = tab === "eat" && cuisine ? `${label}, ${cuisine}` : label;
  // No ratings in OpenStreetMap; well-documented independent places tend to be the ones worth a visit.
  const rank = (t.wikidata ? 6 : 0) + (t.wikipedia ? 4 : 0) + (t.website || t["contact:website"] ? 2 : 0) + (t.opening_hours ? 1 : 0)
    + (cuisine ? 0.5 : 0) + (t.brand ? -3 : 0) - (2 * metersBetween(center, [lat, lon])) / radiusM;
  return { name: t.name, tab, meta, pos: [lat, lon], rank, source: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    sourceName: "OpenStreetMap", raw: e };
}

// Notable places first, then everyday ones; a place both sources know is listed once.
function mergePlaces(lists) {
  const out = { eat: [], see: [] };
  const all = lists.flat().sort((a, b) => b.rank - a.rank);
  for (const p of all) {
    const tab = out[p.tab];
    const dupe = tab.some((q) => q.name.toLowerCase() === p.name.toLowerCase()
      || (metersBetween(q.pos, p.pos) < 60 && q.name.toLowerCase().split(" ")[0] === p.name.toLowerCase().split(" ")[0]));
    if (!dupe && tab.length < PLACES_PER_TAB) tab.push(p);
  }
  return out;
}

function loadPlaces(area) {
  const key = placesKey(area);
  if (placesCache.has(key)) return;
  const entry = { eat: [], see: [], wiki: "loading", osm: "loading", parts: {} };
  placesCache.set(key, entry);
  const update = () => {
    Object.assign(entry, mergePlaces([entry.parts.wiki || [], entry.parts.osm || []]));
    const current = state.results[state.mode]?.[state.selected];
    if (current && placesKey(current) === key) { renderList(); drawPlaces(); }
  };
  wikidataPlaces(area.pos, state.radiusM)
    .then((list) => { entry.parts.wiki = list; entry.wiki = "done"; })
    .catch(() => { entry.wiki = "failed"; })
    .finally(update);
  osmPlaces(area.pos, state.radiusM)
    .then((list) => { entry.parts.osm = list; entry.osm = "done"; })
    .catch(() => { entry.osm = "failed"; })
    .finally(update);
}

function placesFor(area) {
  return placesCache.get(placesKey(area)) || { eat: [], see: [], wiki: "loading", osm: "loading" };
}

function placeLink(p) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.pos[0].toFixed(5)},${p.pos[1].toFixed(5)}`)}`;
}

function renderPlaces(a) {
  const places = placesFor(a);
  const list = places[state.tab];
  const loading = places.wiki === "loading" || places.osm === "loading";
  const rows = list.map((p, i) => `
    <div class="place" data-key="${state.tab}${i}">
      <span class="n ${state.tab}">${i + 1}</span>
      <div class="place-text"><div class="pname">${esc(p.name)}</div><div class="meta">${esc(p.meta)}</div></div>
      <a href="${placeLink(p)}" target="_blank" rel="noopener">Google Maps &#8599;</a>
    </div>`).join("");
  let note = "";
  if (loading) note = list.length ? "Finding more places..." : "Finding places nearby...";
  else if (!list.length) note = state.tab === "eat"
    ? "No places to eat found around here. Try a bigger area, or search Google below."
    : "No shops or things to do found around here. Try a bigger area, or search Google below.";
  else if (places.osm === "failed") note = "Showing well-known places only; the everyday-places map is busy right now.";
  return `
    <div class="tabs">
      <button type="button" data-tab="eat" class="${state.tab === "eat" ? "on" : ""}">Places to eat</button>
      <button type="button" data-tab="see" class="${state.tab === "see" ? "on" : ""}">Shops &amp; things to do</button>
    </div>
    <div class="place-list">${rows}</div>
    ${note ? `<p class="places-note ${loading ? "loading" : ""}">${note}</p>` : ""}`;
}

// ---------- search ----------

async function resolvePeople() {
  const youText = $("you").value.trim(), friendText = $("friend").value.trim();
  if (!youText && !state.you.pos) throw new UserFacingError("Add your address, or tap the target to use your location.");
  if (!friendText) throw new UserFacingError("Add your friend's address.");
  if (!(state.you.fromDevice && youText === state.you.label) && youText !== state.you.query) {
    const g = await geocode(youText, state.friend.pos);
    state.you = { label: youText, query: youText, pos: g.pos, fromDevice: false };
  }
  if (friendText !== state.friend.query) {
    const g = await geocode(friendText, state.you.pos);
    state.friend = { label: friendText, query: friendText, pos: g.pos };
  }
}

let searchKey = "";

async function search() {
  if (state.busy) return;
  state.busy = true;
  $("go").disabled = true;
  try {
    renderBusy("Looking up addresses...");
    await resolvePeople();
    const key = [state.you.pos, state.friend.pos].join("|");
    if (key !== searchKey) { state.results = {}; searchKey = key; }
    if (metersBetween(state.you.pos, state.friend.pos) < 300) {
      throw new UserFacingError("You two are practically next door. Just meet up!");
    }
    if (!state.results[state.mode]) {
      drawMap();
      renderBusy(state.mode === "drive" ? "Timing drives to the middle..." : "Checking trains and buses...");
      const candidates = state.mode === "drive"
        ? await findDriving(state.you.pos, state.friend.pos)
        : await findTransit(state.you.pos, state.friend.pos);
      renderBusy("Finding places to hang out...");
      const areas = await findSpots(candidates, state.mode);
      state.results[state.mode] = areas;
    }
    state.selected = 0;
    showSelected();
  } catch (e) {
    renderError(e instanceof UserFacingError ? e.message : "Something unexpected went wrong. Try again.");
    if (!(e instanceof UserFacingError)) console.error(e);
    drawMap();
  } finally {
    state.busy = false;
    $("go").disabled = false;
  }
}

// ---------- your location ----------

function hint(text, kind) { const h = $("lochint"); h.textContent = text; h.className = kind || ""; }

function locate() {
  const btn = $("locate");
  if (!navigator.geolocation) { hint("This browser can't share your location. Type your address instead.", "warn"); return; }
  btn.classList.add("busy");
  hint("Finding you...");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const here = [pos.coords.latitude, pos.coords.longitude];
    const n = await placeName(here);
    const label = [n.street, n.area].filter(Boolean).join(", ") || `${here[0].toFixed(4)}, ${here[1].toFixed(4)}`;
    state.you = { label, query: label, pos: here, fromDevice: true };
    $("you").value = label;
    btn.classList.remove("busy");
    hint("Using your current location", "ok");
    drawMap();
  }, (err) => {
    btn.classList.remove("busy");
    hint(err.code === err.PERMISSION_DENIED
      ? "Location is blocked. Type your address, or allow location for this site and tap the target."
      : "Couldn't find your location. Type your address instead.", "warn");
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

// ---------- events ----------

$("search").addEventListener("submit", (e) => { e.preventDefault(); search(); });
$("locate").addEventListener("click", locate);
$("you").addEventListener("input", () => hint(""));

$("modes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.mode === state.mode || state.busy) return;
  state.mode = b.dataset.mode;
  state.selected = 0;
  modeButtons.forEach((x) => x.classList.toggle("on", x.dataset.mode === state.mode));
  if ((state.you.pos || $("you").value.trim()) && $("friend").value.trim()) search();
  else { renderList(); drawMap(); }
});

function showSelected() {
  const area = state.results[state.mode]?.[state.selected];
  if (area) loadPlaces(area);
  renderList();
  drawMap();
}

$("results").addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("a")) return;
  if (t.dataset.r) { state.radiusM = +t.dataset.r; showSelected(); return; }
  if (t.dataset.tab) { state.tab = t.dataset.tab; renderList(); drawPlaces(); return; }
  const row = t.closest(".place");
  if (row) {
    // Show the place on the map; on a phone the map is above the list, so scroll up to it.
    const m = placeMarkers.get(row.dataset.key);
    if (isPhone()) $("map").scrollIntoView({ behavior: "smooth" });
    if (m) {
      map.flyTo({ center: m.getLngLat(), zoom: Math.max(map.getZoom(), 15.5), duration: 700 });
      placeMarkers.forEach((x) => x.getPopup()?.isOpen() && x.togglePopup());
      m.togglePopup();
    }
    return;
  }
  const area = t.closest(".area");
  if (area && +area.dataset.idx !== state.selected) { state.selected = +area.dataset.idx; showSelected(); }
});

$("results").addEventListener("mouseover", (e) => {
  const row = e.target.closest(".place");
  if (row) highlightPlace(row.dataset.key.slice(0, 3), +row.dataset.key.slice(3), true);
});
$("results").addEventListener("mouseout", (e) => {
  const row = e.target.closest(".place");
  if (row) highlightPlace(row.dataset.key.slice(0, 3), +row.dataset.key.slice(3), false);
});

renderStart();
locate();
