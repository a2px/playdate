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
const COLORS = { you: "#1f6fe0", friend: "#ff8a1f" };
const AREA_COUNT = 3;
const AREA_SEPARATION_M = 1200; // two suggested spots are at least this far apart
const MAX_SNAP_M = 400; // a driving sample further than this from a road is in water or a park

// ---------- Keith Haring-style figures ----------

const POSES = {
  wave:  { head: [50, 20], lines: [[50,34,50,62],[50,40,28,24],[50,40,72,50],[50,62,34,90],[50,62,68,88]] },
  jump:  { head: [50, 20], lines: [[50,34,50,60],[50,40,26,18],[50,40,74,18],[50,60,30,80],[50,60,70,80]] },
  dance: { head: [46, 20], lines: [[48,34,54,60],[50,40,74,28],[50,40,26,54],[54,60,30,84],[54,60,74,90]] },
  reach: { head: [40, 22], lines: [[44,36,50,62],[46,42,78,18],[46,42,24,54],[50,62,34,90],[50,62,70,86]] },
};

function figure(color, pose = "wave", size = 40, flip = false, motion = true) {
  const p = POSES[pose];
  const seg = (w, c) => p.lines.map(([a, b, c2, d]) =>
    `<line x1="${a}" y1="${b}" x2="${c2}" y2="${d}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`).join("");
  const rays = motion
    ? [[p.head[0] - 20, 6, p.head[0] - 26, 0], [p.head[0], 0, p.head[0], -6], [p.head[0] + 20, 6, p.head[0] + 26, 0], [86, 40, 94, 36], [6, 44, 0, 40]]
      .map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#111" stroke-width="4" stroke-linecap="round"/>`).join("")
    : "";
  return `<svg width="${size}" height="${size}" viewBox="-4 -10 108 108" style="${flip ? "transform:scaleX(-1)" : ""};overflow:visible">
    ${rays}${seg(20, "#111")}<circle cx="${p.head[0]}" cy="${p.head[1]}" r="14" fill="#111"/>
    ${seg(11, color)}<circle cx="${p.head[0]}" cy="${p.head[1]}" r="9.5" fill="${color}"/></svg>`;
}

const bopping = (html, second) => `<span class="bop ${second ? "b2" : ""}" style="display:inline-block">${html}</span>`;

document.getElementById("fig-you").innerHTML = figure(COLORS.you, "wave", 34, false, false);
document.getElementById("fig-friend").innerHTML = figure(COLORS.friend, "wave", 34, true, false);
document.getElementById("hero-figs").innerHTML =
  bopping(figure("#ffd23f", "dance", 54)) + bopping(figure(COLORS.you, "jump", 54, true), true);
const modeButtons = document.querySelectorAll("#modes button");
modeButtons[0].insertAdjacentHTML("afterbegin", `<svg width="22" height="16" viewBox="0 0 44 30"><path d="M4 20 L8 10 Q10 6 15 6 L30 6 Q34 6 36 10 L40 20 Z" fill="#ff5fa2" stroke="#111" stroke-width="4" stroke-linejoin="round"/><circle cx="12" cy="22" r="5" fill="#111"/><circle cx="32" cy="22" r="5" fill="#111"/></svg>`);
modeButtons[1].insertAdjacentHTML("afterbegin", `<svg width="18" height="18" viewBox="0 0 36 36"><rect x="5" y="3" width="26" height="24" rx="6" fill="#16a34a" stroke="#111" stroke-width="4"/><rect x="10" y="8" width="16" height="8" fill="#fff" stroke="#111" stroke-width="3"/><line x1="9" y1="33" x2="13" y2="27" stroke="#111" stroke-width="4" stroke-linecap="round"/><line x1="27" y1="33" x2="23" y2="27" stroke="#111" stroke-width="4" stroke-linecap="round"/></svg>`);

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
    const j = await getJson(`${SERVICES.wikipedia}?${params}`, "Wikipedia");
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
  radiusM: 800,
  busy: false,
};

// ---------- map ----------

const map = L.map("map", { zoomControl: true }).setView([37.79, -122.35], 10);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
}).addTo(map);
const layer = L.layerGroup().addTo(map);

function personMarker(pos, name, color, flip) {
  const icon = L.divIcon({ className: "", iconSize: [54, 54], iconAnchor: [27, 50], html: figure(color, "wave", 54, flip) });
  L.marker(pos, { icon }).addTo(layer)
    .bindTooltip(`<span class="who">${name}</span>`, { permanent: true, direction: "bottom", offset: [0, 4], className: "plain" });
}

function meetMarker(center) {
  const html = `<div style="display:flex;align-items:flex-end;justify-content:center;width:84px">
    ${figure(COLORS.you, "reach", 46, false, false)}<span style="margin-left:-14px">${figure(COLORS.friend, "reach", 46, true, false)}</span></div>`;
  const icon = L.divIcon({ className: "", iconSize: [84, 52], iconAnchor: [42, 48], html });
  // Sit the pair on the circle's top edge so they never cover what is inside it.
  const top = [center[0] + state.radiusM / 111320, center[1]];
  L.marker(top, { icon, zIndexOffset: 1000, interactive: false }).addTo(layer);
}

function drawMap() {
  layer.clearLayers();
  const areas = state.results[state.mode];
  const area = areas && areas[state.selected];
  if (area) {
    const dash = state.mode === "transit" ? "1 12" : "14 10";
    for (const [p, c] of [[state.you.pos, COLORS.you], [state.friend.pos, COLORS.friend]]) {
      L.polyline([p, area.pos], { color: "#111", weight: 9, opacity: .9, dashArray: dash, lineCap: "round" }).addTo(layer);
      L.polyline([p, area.pos], { color: c, weight: 5, dashArray: dash, lineCap: "round" }).addTo(layer);
    }
    L.circle(area.pos, { radius: state.radiusM, color: "#111", weight: 4, dashArray: "10 8", fillColor: "#ffd23f", fillOpacity: .28 }).addTo(layer);
  }
  if (state.you.pos) personMarker(state.you.pos, "You", COLORS.you, false);
  if (state.friend.pos) personMarker(state.friend.pos, "Friend", COLORS.friend, true);
  if (area) {
    meetMarker(area.pos);
    map.flyToBounds(L.latLng(area.pos).toBounds(state.radiusM * (isPhone() ? 2.3 : 2.8)), { duration: .6 });
  } else if (state.you.pos && state.friend.pos) {
    map.fitBounds([state.you.pos, state.friend.pos], { padding: [60, 60] });
  } else if (state.you.pos) {
    map.setView(state.you.pos, 13);
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
    <div class="figs">${figure(COLORS.you, "wave", 56)}${figure(COLORS.friend, "wave", 56, true)}</div>
    <p class="big">Where are you two?</p>
    <p>Add both addresses and pick how you're getting there. We'll find spots that take you about the same time.</p></div>`;
}

function renderBusy(text) {
  $("results").innerHTML = `<div class="state">
    <div class="figs">${bopping(figure(COLORS.you, "dance", 56))}${bopping(figure(COLORS.friend, "jump", 56, true), true)}</div>
    <p class="big">${esc(text)}</p></div>`;
}

function renderError(message) {
  $("results").innerHTML = `<div class="state error">
    <div class="figs">${figure("#e8302a", "jump", 56, false, false)}</div>
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
          <div class="explore">
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
    renderList();
    drawMap();
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

$("results").addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("a")) return;
  if (t.dataset.r) { state.radiusM = +t.dataset.r; renderList(); drawMap(); return; }
  const area = t.closest(".area");
  if (area && +area.dataset.idx !== state.selected) { state.selected = +area.dataset.idx; renderList(); drawMap(); }
});

window.addEventListener("resize", () => map.invalidateSize());

renderStart();
locate();
