import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const host = document.getElementById('view');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.innerHTML = '';
host.appendChild(renderer.domElement);
camera.position.set(0, 0, 5.4);

scene.add(new THREE.AmbientLight(0x8795c7, 1.15));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(-4, 3, 5);
scene.add(keyLight);

const group = new THREE.Group();
scene.add(group);

const labelLayer = document.createElement('div');
labelLayer.className = 'model-label-layer';
host.appendChild(labelLayer);

const leaderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
leaderSvg.setAttribute('class', 'model-leaders');
labelLayer.appendChild(leaderSvg);

let labelNodes = [];
let active = 'earth';
let drag = null;
let pointerStart = null;
let rx = 0.12;
let ry = -0.35;
let zoom = 1;
let raf = 0;
let phase = 'full';
let cellRoot = null;
let cellMesh = null;
let cellLoadPromise = null;
let cellParts = [];
let activeCellPart = -1;

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

function earthTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12508d';
  ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = '#3c9567';

  const polygons = [
    [[90,145],[140,100],[215,90],[260,125],[245,165],[205,180],[180,230],[140,215],[120,180]],
    [[235,240],[280,255],[300,310],[280,390],[250,430],[225,360]],
    [[430,100],[490,75],[555,95],[590,135],[570,175],[520,190],[500,230],[455,205],[430,160]],
    [[520,230],[580,240],[610,300],[580,390],[550,440],[525,350]],
    [[610,95],[700,80],[780,115],[810,160],[760,190],[710,170],[670,200],[630,160]],
    [[760,300],[830,285],[880,330],[850,370],[800,360]]
  ];

  polygons.forEach(poly => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fill();
  });

  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#e9f5ff';
  for (let i = 0; i < 20; i++) {
    ctx.beginPath();
    ctx.ellipse((i * 71) % 1024, (i * 43) % 512, 35 + (i % 4) * 12, 5 + (i % 3) * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

function loadTexture(url, color = false) {
  const texture = textureLoader.load(url, undefined, undefined, () => {});
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const earthMap = loadTexture('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg', true);
const earthBump = loadTexture('https://threejs.org/examples/textures/planets/earth_bump_2048.jpg');
const cloudMap = loadTexture('https://threejs.org/examples/textures/planets/earth_clouds_1024.png', true);
const moonMap = loadTexture('https://threejs.org/examples/textures/planets/moon_1024.jpg', true);

const earthMat = new THREE.MeshStandardMaterial({
  map: earthMap,
  bumpMap: earthBump,
  bumpScale: 0.045,
  roughness: 0.92,
  metalness: 0
});
const moonMat = new THREE.MeshStandardMaterial({ map: moonMap, roughness: 1 });
const sphere = (radius, material) => new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), material);

function disposeObject(object) {
  object.traverse(child => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => material?.dispose());
  });
}

function clear() {
  while (group.children.length) {
    const object = group.children[0];
    group.remove(object);
    // Keep the loaded GLB cached when switching between the three lab models.
    if (!object.userData.keepAsset) disposeObject(object);
  }
}

function addEarth() {
  const earth = sphere(1.25, earthMat);
  group.add(earth);

  const cloudMat = new THREE.MeshStandardMaterial({
    map: cloudMap,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    roughness: 1
  });
  group.add(sphere(1.268, cloudMat));

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.31, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vNormal;void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vNormal;void main(){float intensity=pow(0.68-dot(vNormal,vec3(0.0,0.0,1.0)),3.0);gl_FragColor=vec4(0.18,0.48,1.0,intensity*0.42);}`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  group.add(atmosphere);

  const axis = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 3.2, 8),
    new THREE.MeshBasicMaterial({ color: 0x9ebeff, transparent: true, opacity: 0.2 })
  );
  axis.rotation.z = -0.28;
  group.add(axis);
}

function addMoon() {
  group.add(sphere(1.2, moonMat));
  const phases = { new: [0, 0, -4], first: [4, 0, 0], full: [0, 0, 4], last: [-4, 0, 0] };
  keyLight.position.set(...phases[phase]);

  const earth = sphere(0.32, new THREE.MeshStandardMaterial({ color: 0x3276bb }));
  earth.position.set(-2.2, -1.25, 0);
  group.add(earth);

  const orbit = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.008, 4, 100),
    new THREE.MeshBasicMaterial({ color: 0x8e82c9, transparent: true, opacity: 0.35 })
  );
  orbit.rotation.x = 1.05;
  group.add(orbit);
}

const cellPartInfo = [
  { name: 'CELL MEMBRANE', material: 'Cell_Membrane', color: '#7ddbd4', desc: 'A selectively permeable boundary that regulates movement of substances into and out of the cell.' },
  { name: 'CYTOPLASM', material: 'Cytoplasm', color: '#76c9b0', desc: 'The cell contents between the plasma membrane and nucleus, where many metabolic reactions occur.' },
  { name: 'NUCLEUS', material: 'Nucleus', color: '#c47be8', desc: 'The control centre of the eukaryotic cell; it contains most of the cell’s genetic material.' },
  { name: 'NUCLEOPLASM', material: 'Nucleoplasm', color: '#b99be9', desc: 'The semi-fluid material inside the nucleus in which chromatin and the nucleolus are present.' },
  { name: 'NUCLEOLUS', material: 'Nucleolus', color: '#f2c3ff', desc: 'A dense region inside the nucleus involved in rRNA synthesis and ribosome subunit assembly.' },
  { name: 'MITOCHONDRION', material: 'Mitochondrion', color: '#ff9a70', desc: 'The site of aerobic respiration and major ATP production; often called the powerhouse of the cell.' },
  { name: 'GOLGI APPARATUS', material: 'Golgi', color: '#e9b76b', desc: 'Modifies, sorts and packages proteins and lipids for transport or secretion.' },
  { name: 'ENDOPLASMIC RETICULUM', material: 'ER', color: '#79a9f5', desc: 'A membrane network. Rough ER is associated with protein synthesis; smooth ER is involved in lipid synthesis.' },
  { name: 'RIBOSOMES', material: 'Ribosome', color: '#f6d18b', desc: 'Ribosomes are the sites of protein synthesis.' },
  { name: 'VESICLES', material: 'Vesicle', color: '#8ed3f0', desc: 'Small membrane-bound sacs involved in transport and storage within the cell.' },
  { name: 'LYSOSOMES', material: 'Lysosome', color: '#e78eaa', desc: 'Membrane-bound sacs containing hydrolytic enzymes that help digest materials and worn-out cell components.' },
  { name: 'CENTRIOLES', material: 'Centriole', color: '#a9a2ff', desc: 'Cylindrical structures involved in organizing the spindle during animal-cell division.' }
];

const diagramParts = {
  earth: [
    ['#4fa7ff', 'OCEANS', 'Large bodies of liquid water covering much of Earth.'],
    ['#5fc58a', 'CONTINENTS', 'Earth’s major continuous land areas.'],
    ['#dcecff', 'CLOUD LAYER', 'Water droplets and ice crystals suspended in the atmosphere.'],
    ['#8a9fff', 'ATMOSPHERE', 'The layer of gases surrounding our planet.']
  ],
  moon: [
    ['#f4e8c9', 'SUNLIT SIDE', 'The half of the Moon currently illuminated by the Sun.'],
    ['#596078', 'SHADOWED SIDE', 'The half turned away from direct sunlight.'],
    ['#4f9fff', 'EARTH', 'Our planet, shown smaller than scale for clarity.'],
    ['#b9a5ff', 'ORBIT PATH', 'A guide to the Moon’s path around Earth.']
  ]
};

const info = {
  earth: {
    tag: 'PLANET EARTH',
    name: 'EARTH',
    desc: 'Our home world is a dynamic planet with oceans, continents, a protective atmosphere and a magnetic field.',
    facts: ['Terrestrial planet', 'About 4.54 billion years', '71% covered by water'],
    guide: 'Drag the model to inspect the globe. Continents and clouds are simplified educational artwork, not a precise satellite map.'
  },
  moon: {
    tag: 'EARTH’S NATURAL SATELLITE',
    name: 'THE MOON',
    desc: 'The Moon orbits Earth and rotates at nearly the same rate, which is why we usually see the same hemisphere. Its changing phases are caused by the changing view of its sunlit half.',
    facts: ['Natural satellite', 'About 29.5 days per phase cycle', 'No significant atmosphere'],
    guide: 'Choose a phase below. The illuminated portion changes as the Moon moves around Earth. The small Earth shown beside it is not to scale.'
  },
  cell: {
    tag: 'BIOLOGY / CELL STRUCTURE',
    name: 'AN ANIMAL CELL',
    desc: 'Explore a detailed 3D animal cell. Select an organelle from the model or the anatomy list to learn its function.',
    facts: ['Eukaryotic cell', '12 labelled structures', 'Interactive 3D asset'],
    guide: 'Loading the detailed animal-cell model…'
  }
};

function makeLabel(name, color = '#c9b7ff') {
  const node = document.createElement('div');
  node.className = 'model-label';
  node.textContent = name;
  node.style.setProperty('--label-accent', color);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.4');
  line.setAttribute('stroke-linecap', 'round');
  leaderSvg.appendChild(line);
  labelLayer.appendChild(node);
  return { node, line };
}

function setStaticLabels(model) {
  labelLayer.querySelectorAll('.model-label').forEach(node => node.remove());
  leaderSvg.innerHTML = '';
  labelNodes = [];

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const specs = {
    earth: [
      ['OCEANS', V(0.12, 0.18, 1.23), 90, -65],
      ['CONTINENTS', V(-0.62, 0.42, 1.02), -155, -55],
      ['CLOUDS', V(0.7, 0.55, 0.86), 105, 0],
      ['ATMOSPHERE', V(0, 0, 1.31), -150, 70]
    ],
    moon: [
      ['SUNLIT SIDE', V(0.45, 0.38, 1.08), 115, -45],
      ['SHADOWED SIDE', V(-0.65, -0.25, 0.95), -155, 20],
      ['EARTH', V(-2.2, -1.25, 0), -120, 35],
      ['ORBIT PATH', V(1.55, -1.55, 0), 95, 45]
    ]
  };

  (specs[model] || []).forEach(([name, point, dx, dy]) => {
    const { node, line } = makeLabel(name);
    labelNodes.push({ node, line, point, dx, dy, object: null });
  });
}

function getPrimitiveBounds(geometry, drawGroup) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const end = drawGroup.start + drawGroup.count;

  for (let i = drawGroup.start; i < end; i++) {
    const vertexIndex = index ? index.getX(i) : i;
    const point = new THREE.Vector3().fromBufferAttribute(position, vertexIndex);
    min.min(point);
    max.max(point);
  }

  return { min, max, center: min.clone().add(max).multiplyScalar(0.5) };
}

function buildCellPartAnchors(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const byMaterial = new Map();

  mesh.geometry.groups.forEach(drawGroup => {
    const material = materials[drawGroup.materialIndex];
    const materialName = material?.name || '';
    const part = cellPartInfo.find(item => item.material === materialName);
    if (!part) return;

    const bounds = getPrimitiveBounds(mesh.geometry, drawGroup);
    const existing = byMaterial.get(drawGroup.materialIndex);
    if (!existing) {
      byMaterial.set(drawGroup.materialIndex, {
        ...part,
        materialIndex: drawGroup.materialIndex,
        min: bounds.min.clone(),
        max: bounds.max.clone()
      });
    } else {
      existing.min.min(bounds.min);
      existing.max.max(bounds.max);
    }
  });

  cellParts = Array.from(byMaterial.values()).map(part => ({
    ...part,
    center: part.min.clone().add(part.max).multiplyScalar(0.5)
  }));

  cellParts.sort((a, b) => cellPartInfo.findIndex(x => x.material === a.material) - cellPartInfo.findIndex(x => x.material === b.material));
}

function renderCellLegend() {
  const container = document.getElementById('diagramLabels');
  const legend = document.getElementById('legend');
  if (!container) return;

  container.innerHTML = '<ul class="cell-anatomy-list">' + cellPartInfo.map(part => `
    <li style="--dot:${part.color}">
      <i></i>
      <span>
        <button type="button" class="cell-part-button" data-cell-material="${part.material}" aria-pressed="false">
          <strong>${part.name}</strong>
          <small>${part.desc}</small>
        </button>
      </span>
    </li>`).join('') + '</ul>';

  if (legend) legend.hidden = false;
}

function selectCellPart(materialIndex) {
  if (!cellMesh || active !== 'cell') return;
  const materials = Array.isArray(cellMesh.material) ? cellMesh.material : [cellMesh.material];

  if (activeCellPart >= 0 && materials[activeCellPart]) {
    materials[activeCellPart].emissive?.setHex(0x000000);
    if (materials[activeCellPart].emissive) materials[activeCellPart].emissiveIntensity = 0;
  }

  activeCellPart = materialIndex;
  if (materials[materialIndex]?.emissive) {
    materials[materialIndex].emissive.setHex(0x6b4cff);
    materials[materialIndex].emissiveIntensity = 0.55;
  }

  const part = cellParts.find(item => item.materialIndex === materialIndex);
  if (!part) return;

  document.querySelectorAll('[data-cell-material]').forEach(button => {
    const selected = button.dataset.cellMaterial === part.material;
    button.setAttribute('aria-pressed', String(selected));
  });

  const guideTitle = document.getElementById('guideTitle');
  const guideText = document.getElementById('guideText');
  if (guideTitle) guideTitle.textContent = part.name;
  if (guideText) guideText.textContent = part.desc;
}

function setCellLabels() {
  labelLayer.querySelectorAll('.model-label').forEach(node => node.remove());
  leaderSvg.innerHTML = '';
  labelNodes = [];

  cellParts.forEach(part => {
    const { node, line } = makeLabel(part.name, part.color);
    labelNodes.push({
      node,
      line,
      point: part.center.clone(),
      object: cellMesh,
      dx: part.center.x >= 0 ? 115 : -115,
      dy: part.center.y >= 0 ? -30 : 35,
      materialIndex: part.materialIndex
    });
  });
}

function loadCellModel() {
  if (cellRoot) {
    group.add(cellRoot);
    cellMesh = null;
    cellRoot.traverse(object => {
      if (object.isMesh && object.geometry?.groups?.length) cellMesh = object;
    });
    if (cellMesh) {
      buildCellPartAnchors(cellMesh);
      setCellLabels();
      renderCellLegend();
    }
    return Promise.resolve();
  }

  if (cellLoadPromise) return cellLoadPromise;

  const guideText = document.getElementById('guideText');
  const loader = new GLTFLoader();

  cellLoadPromise = new Promise((resolve, reject) => {
    loader.load(
      'assets/models/animal-cell.glb',
      gltf => {
        cellRoot = gltf.scene;
        cellRoot.userData.keepAsset = true;

        const bounds = new THREE.Box3().setFromObject(cellRoot);
        const center = bounds.getCenter(new THREE.Vector3());
        cellRoot.scale.setScalar(2.35);
        cellRoot.position.sub(center.multiplyScalar(2.35));

        cellRoot.traverse(object => {
          if (!object.isMesh) return;
          object.castShadow = false;
          object.receiveShadow = false;
          if (object.geometry?.groups?.length) cellMesh = object;
        });

        if (!cellMesh) {
          reject(new Error('The GLB loaded, but no grouped cell mesh was found.'));
          return;
        }

        group.add(cellRoot);
        buildCellPartAnchors(cellMesh);
        setCellLabels();
        renderCellLegend();

        if (guideText) {
          guideText.textContent = 'Select an organelle in the model or anatomy list. Drag to rotate and use the wheel or trackpad to zoom. 3D asset credit: Vinish (vinish.dev).';
        }

        resolve();
      },
      event => {
        if (guideText && event.total) {
          const percent = Math.round((event.loaded / event.total) * 100);
          guideText.textContent = `Loading detailed animal cell… ${percent}%`;
        }
      },
      error => {
        console.error('Animal-cell GLB failed to load:', error);
        if (guideText) {
          guideText.textContent = 'The animal-cell model could not load. Check that assets/models/animal-cell.glb is published and try refreshing the page.';
        }
        reject(error);
      }
    );
  }).catch(error => {
    cellLoadPromise = null;
    throw error;
  });

  return cellLoadPromise;
}

function updateAttachedLabels() {
  const width = host.clientWidth;
  const height = host.clientHeight;
  leaderSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  group.updateMatrixWorld(true);
  camera.updateMatrixWorld();

  labelNodes.forEach(({ node, line, point, dx, dy, object }) => {
    const world = object ? object.localToWorld(point.clone()) : point.clone().applyMatrix4(group.matrixWorld);
    const normal = world.clone().normalize();
    const towardCamera = new THREE.Vector3().subVectors(camera.position, world).normalize();
    const projected = world.clone().project(camera);
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    const visible = projected.z < 1 && projected.z > -1 &&
      normal.dot(towardCamera) > -0.05 && x > 0 && x < width && y > 0 && y < height;

    node.style.display = visible ? 'block' : 'none';
    line.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    const labelX = Math.max(65, Math.min(width - 65, x + dx));
    const labelY = Math.max(22, Math.min(height - 22, y + dy));
    node.style.left = `${labelX}px`;
    node.style.top = `${labelY}px`;

    const edgeX = labelX + (dx < 0 ? node.offsetWidth / 2 : -node.offsetWidth / 2);
    line.setAttribute('x1', x);
    line.setAttribute('y1', y);
    line.setAttribute('x2', edgeX);
    line.setAttribute('y2', labelY);
  });
}

function choose(model) {
  active = model;
  document.querySelectorAll('[data-model]').forEach(button => {
    button.classList.toggle('active', button.dataset.model === model);
  });

  const data = info[model];
  document.getElementById('tag').textContent = data.tag;
  document.getElementById('index').textContent = ({ earth: '01 / 03', moon: '02 / 03', cell: '03 / 03' })[model];
  document.getElementById('name').textContent = data.name;
  document.getElementById('description').textContent = data.desc;
  document.getElementById('facts').innerHTML = data.facts.map((value, i) =>
    `<div><small>${['TYPE', 'KEY DETAIL', 'FEATURE'][i]}</small><strong>${value}</strong></div>`
  ).join('');

  document.getElementById('guideTitle').textContent = model === 'cell' ? 'CELL ANATOMY' : 'LOOK CLOSER';
  document.getElementById('guideText').textContent = data.guide;

  const phaseControls = document.getElementById('phaseControls');
  const legend = document.getElementById('legend');
  if (phaseControls) phaseControls.hidden = model !== 'moon';
  if (legend) legend.hidden = model !== 'cell';

  clear();
  labelLayer.querySelectorAll('.model-label').forEach(node => node.remove());
  leaderSvg.innerHTML = '';
  labelNodes = [];
  activeCellPart = -1;

  if (model === 'earth') {
    addEarth();
    setStaticLabels('earth');
  } else if (model === 'moon') {
    addMoon();
    setStaticLabels('moon');
  } else if (model === 'cell') {
    loadCellModel().catch(error => console.error(error));
  }

  rx = 0.12;
  ry = -0.35;
  zoom = 1;
}

document.querySelectorAll('[data-model]').forEach(button => {
  button.addEventListener('click', () => choose(button.dataset.model));
});

document.querySelectorAll('[data-phase]').forEach(button => {
  button.addEventListener('click', () => {
    phase = button.dataset.phase;
    document.querySelectorAll('[data-phase]').forEach(item => item.classList.toggle('active', item === button));
    if (active === 'moon') {
      const positions = { new: [0, 0, -4], first: [4, 0, 0], full: [0, 0, 4], last: [-4, 0, 0] };
      keyLight.position.set(...positions[phase]);
    }
  });
});

document.getElementById('diagramLabels')?.addEventListener('click', event => {
  const button = event.target.closest('[data-cell-material]');
  if (!button || !cellMesh) return;
  const part = cellParts.find(item => item.material === button.dataset.cellMaterial);
  if (part) selectCellPart(part.materialIndex);
});

renderer.domElement.addEventListener('pointerdown', event => {
  drag = { x: event.clientX, y: event.clientY };
  pointerStart = { x: event.clientX, y: event.clientY };
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener('pointermove', event => {
  if (!drag) return;
  ry += (event.clientX - drag.x) * 0.006;
  rx = Math.max(-1.2, Math.min(1.2, rx + (event.clientY - drag.y) * 0.005));
  drag = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener('pointerup', event => {
  if (pointerStart && active === 'cell' &&
      Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 5 &&
      cellMesh) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObject(cellMesh, false)[0];
    if (hit?.face) selectCellPart(hit.face.materialIndex);
  }
  drag = null;
  pointerStart = null;
});

renderer.domElement.addEventListener('pointercancel', () => {
  drag = null;
  pointerStart = null;
});

renderer.domElement.addEventListener('wheel', event => {
  event.preventDefault();
  zoom = Math.max(0.65, Math.min(1.7, zoom * (event.deltaY > 0 ? 0.94 : 1.06)));
}, { passive: false });

function resize() {
  const width = host.clientWidth;
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();

function animate() {
  raf = requestAnimationFrame(animate);
  const delta = clock.getDelta();
  group.rotation.x = rx;
  group.rotation.y = ry;
  if (active === 'earth') group.rotation.y += delta * 0.06;
  camera.position.z = 5.4 / zoom;
  renderer.render(scene, camera);
  updateAttachedLabels();
}
animate();

document.getElementById('reset').addEventListener('click', () => {
  rx = 0.12;
  ry = -0.35;
  zoom = 1;
});

window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(raf);
  renderer.dispose();
  disposeObject(group);
});

choose('earth');
