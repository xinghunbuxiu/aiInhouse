<template>
  <div class="w-full h-[500px] rounded-lg overflow-hidden shadow-md">
    <div v-if="!parseData && !sceneConfig" class="w-full h-full flex items-center justify-center bg-gray-100">
      <p class="text-gray-500">正在加载3D场景...</p>
    </div>
    <div v-else ref="sceneContainer" class="w-full h-full"></div>
  </div>
</template>

<script>
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { markRaw } from 'vue';
import { aiService } from '../services/aiService.js';

export default {
  name: 'ThreeDScene',
  props: {
    parseData: {
      type: Object,
      default: null
    },
    materialData: {
      type: Object,
      default: () => ({})
    },
    sceneConfig: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      scene: null,
      camera: null,
      renderer: null,
      controls: null,
      animationId: null,
      materials: {
        floor: null,
        wall: null,
        door: null,
        window: null,
        sofa: null,
        wood: null,
        plastic: null,
        metal: null
      },
      aiConfig: null,
      isLoading: true,
      normalizedRooms: [],
      renderRequestId: 0
    };
  },
  mounted() {
    if (this.parseData || this.sceneConfig) {
      this.loadAIConfig();
    }
  },
  watch: {
    parseData: {
      handler(newData) {
        if (newData) {
          this.loadAIConfig();
        }
      },
      immediate: true
    },
    materialData: {
      handler(newData) {
        if (newData && (this.parseData || this.sceneConfig)) {
          this.loadAIConfig();
        }
      }
    },
    sceneConfig: {
      handler(newData) {
        if (newData) {
          this.loadAIConfig()
        }
      }
    }
  },
  beforeUnmount() {
    this.destroyScene()
  },
  methods: {
    async loadAIConfig() {
      const requestId = ++this.renderRequestId
      try {
        this.isLoading = true;
        console.log('开始加载AI配置...');
        
        const style = this.materialData.style || 'modern';
        this.aiConfig = this.sceneConfig || await aiService.generate3DConfig(this.parseData, style);
        if (requestId !== this.renderRequestId) {
          return
        }
        
        console.log('AI配置加载完成:', this.aiConfig);
        
        // 初始化场景并应用配置
        this.$nextTick(() => {
          if (requestId !== this.renderRequestId) {
            return
          }
          this.initScene();
          this.createMaterials();
          this.createRooms();
          this.animate();
          this.isLoading = false;
        });
      } catch (error) {
        console.error('加载AI配置失败:', error);
        // 失败时使用默认配置
        this.aiConfig = aiService.getMock3DConfig(this.materialData.style || 'modern');
        this.$nextTick(() => {
          if (requestId !== this.renderRequestId) {
            return
          }
          this.initScene();
          this.createMaterials();
          this.createRooms();
          this.animate();
          this.isLoading = false;
        });
      }
    },
    destroyScene() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId)
        this.animationId = null
      }

      if (this.controls) {
        this.controls.dispose()
        this.controls = null
      }

      if (this.scene) {
        this.scene.traverse((object) => {
          if (object.geometry) {
            object.geometry.dispose()
          }
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose?.())
          } else if (object.material) {
            object.material.dispose?.()
          }
        })
        this.scene = null
      }

      if (this.renderer) {
        this.renderer.dispose()
        this.renderer.domElement?.remove()
        this.renderer = null
      }
    },
    createConfiguredFurniture() {
      if (!this.aiConfig || !this.aiConfig.furniture || !this.scene) return;
      
      console.log('开始创建家具...');
      
      this.aiConfig.furniture.forEach(item => {
        let geometry;
        let material;
        
        // 根据家具类型创建几何体
        switch (item.type) {
          case 'sofa':
            geometry = markRaw(new THREE.BoxGeometry(2, 0.8, 1));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: this.aiConfig.materials.floor.color || 0xD2B48C,
              roughness: 0.7
            }));
            break;
          case 'coffeeTable':
            geometry = markRaw(new THREE.BoxGeometry(1, 0.4, 0.8));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: this.aiConfig.materials.floor.color || 0x8B4513,
              roughness: 0.6
            }));
            break;
          case 'tv':
            geometry = markRaw(new THREE.BoxGeometry(0.1, 0.6, 0.9));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: 0x000000,
              roughness: 0.2,
              metalness: 0.8
            }));
            break;
          case 'bed':
            geometry = markRaw(new THREE.BoxGeometry(2, 0.5, 1.8));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: this.aiConfig.materials.floor.color || 0xD2B48C,
              roughness: 0.7
            }));
            break;
          case 'wardrobe':
            geometry = markRaw(new THREE.BoxGeometry(0.6, 2, 1.8));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: this.aiConfig.materials.floor.color || 0x8B4513,
              roughness: 0.6
            }));
            break;
          case 'kitchenCabinet':
            geometry = markRaw(new THREE.BoxGeometry(2, 1.2, 0.6));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: this.aiConfig.materials.floor.color || 0x8B4513,
              roughness: 0.6
            }));
            break;
          case 'sink':
            geometry = markRaw(new THREE.BoxGeometry(0.6, 0.2, 0.6));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: 0xFFFFFF,
              roughness: 0.3
            }));
            break;
          default:
            geometry = markRaw(new THREE.BoxGeometry(1, 1, 1));
            material = markRaw(new THREE.MeshStandardMaterial({ 
              color: 0xCCCCCC,
              roughness: 0.5
            }));
        }
        
        // 创建家具网格
        const furniture = markRaw(new THREE.Mesh(geometry, material));
        
        // 设置位置、旋转和缩放
        furniture.position.set(
          item.position.x || 0,
          item.position.y || 0,
          item.position.z || 0
        );
        
        furniture.rotation.set(
          (item.rotation.x || 0) * Math.PI / 180,
          (item.rotation.y || 0) * Math.PI / 180,
          (item.rotation.z || 0) * Math.PI / 180
        );
        
        furniture.scale.set(
          item.scale.x || 1,
          item.scale.y || 1,
          item.scale.z || 1
        );
        
        // 开启阴影
        furniture.castShadow = true;
        furniture.receiveShadow = true;
        
        // 添加到场景
        this.scene.add(furniture);
      });
      
      console.log('家具创建完成');
    },
    initScene() {
      // 清理之前的场景
      this.destroyScene()
      if (this.$refs.sceneContainer) {
        this.$refs.sceneContainer.innerHTML = '';
      }
      
      // 创建场景 - 使用markRaw避免Vue 3响应式代理
      this.scene = markRaw(new THREE.Scene());
      
      // 创建相机
      const width = this.$refs.sceneContainer.clientWidth;
      const height = this.$refs.sceneContainer.clientHeight;
      this.camera = markRaw(new THREE.PerspectiveCamera(50, width / height, 0.1, 1000));
      this.camera.position.set(15, 8, 15);
      this.camera.lookAt(0, 0, 0);
      
      // 创建渲染器
      this.renderer = markRaw(new THREE.WebGLRenderer({ 
        antialias: true, 
        alpha: true 
      }));
      this.renderer.setSize(width, height);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.$refs.sceneContainer.appendChild(this.renderer.domElement);
      
      // 添加轨道控制器
      this.controls = markRaw(new OrbitControls(this.camera, this.renderer.domElement));
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.minDistance = 5;
      this.controls.maxDistance = 50;
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = Math.PI / 2;
      
      // 添加灯光
      // 环境光
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
      this.scene.add(ambientLight);
      
      // 方向光（主光源 - 模拟太阳光）
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
      directionalLight.position.set(10, 30, 15);
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.width = 4096;
      directionalLight.shadow.mapSize.height = 4096;
      directionalLight.shadow.camera.near = 0.5;
      directionalLight.shadow.camera.far = 100;
      directionalLight.shadow.camera.left = -20;
      directionalLight.shadow.camera.right = 20;
      directionalLight.shadow.camera.top = 20;
      directionalLight.shadow.camera.bottom = -20;
      this.scene.add(directionalLight);
      
      // 天空光
      const skyLight = new THREE.HemisphereLight(0x87CEEB, 0x2c3e50, 0.6);
      this.scene.add(skyLight);
      
      // 室内补光
      const pointLight1 = new THREE.PointLight(0xffffff, 0.6);
      pointLight1.position.set(0, 3, 0);
      pointLight1.castShadow = true;
      this.scene.add(pointLight1);
      
      const pointLight2 = new THREE.PointLight(0xffffff, 0.4);
      pointLight2.position.set(5, 2, 5);
      this.scene.add(pointLight2);
      
      // 添加网格辅助线（可选）
      const gridHelper = new THREE.GridHelper(50, 50, 0x888888, 0x444444);
      gridHelper.visible = false; // 隐藏网格线，使场景更干净
      this.scene.add(gridHelper);
    },
    createMaterials() {
      // 根据材质数据创建材质
      const style = this.materialData.style || 'modern';
      
      // 地板材质
      const floorColor = this.aiConfig?.materials?.floor?.color
      const wallColor = this.aiConfig?.materials?.wall?.color

      switch (style) {
        case 'modern':
          // 现代风格 - 木纹地板
          this.materials.floor = markRaw(new THREE.MeshStandardMaterial({ 
            color: 0xD2B48C, // 原木色
            roughness: 0.7,
            metalness: 0.1
          }));
          break;
        case 'classic':
          // 经典风格 - 深色木地板
          this.materials.floor = markRaw(new THREE.MeshStandardMaterial({ 
            color: 0x8B4513, // 深色木
            roughness: 0.6,
            metalness: 0.2
          }));
          break;
        case 'minimalist':
          // 极简风格 - 白色瓷砖
          this.materials.floor = markRaw(new THREE.MeshStandardMaterial({ 
            color: 0xFFFFFF, // 白色
            roughness: 0.5,
            metalness: 0.1
          }));
          break;
        case 'industrial':
          // 工业风格 - 混凝土
          this.materials.floor = markRaw(new THREE.MeshStandardMaterial({ 
            color: 0xA9A9A9, // 混凝土色
            roughness: 0.8,
            metalness: 0.3
          }));
          break;
        case 'scandinavian':
          // 北欧风格 - 浅色木
          this.materials.floor = markRaw(new THREE.MeshStandardMaterial({ 
            color: 0xF5DEB3, // 浅色木
            roughness: 0.7,
            metalness: 0.1
          }));
          break;
        default:
          this.materials.floor = markRaw(new THREE.MeshStandardMaterial({ 
            color: 0xD2B48C,
            roughness: 0.7,
            metalness: 0.1
          }));
      }
      
      // 墙壁材质
      this.materials.wall = markRaw(new THREE.MeshStandardMaterial({ 
        color: wallColor || 0xF5F5F5,
        roughness: 0.8,
        metalness: 0.05
      }));

      if (floorColor) {
        this.materials.floor.color = new THREE.Color(floorColor)
      }
      
      // 门材质
      this.materials.door = markRaw(new THREE.MeshStandardMaterial({ 
        color: 0x8B4513, // 木色
        roughness: 0.7,
        metalness: 0.1
      }));
      
      // 窗户材质
      this.materials.window = markRaw(new THREE.MeshStandardMaterial({ 
        color: 0x87CEEB, // 蓝色
        roughness: 0.05,
        metalness: 0.5,
        transparent: true,
        opacity: 0.3
      }));
      
      // 家具材质
      this.materials.sofa = markRaw(new THREE.MeshStandardMaterial({ 
        color: 0xC19A6B, // 沙发色
        roughness: 0.8,
        metalness: 0.05
      }));
      this.materials.wood = markRaw(new THREE.MeshStandardMaterial({ 
        color: 0x8B4513, // 木色
        roughness: 0.7,
        metalness: 0.1
      }));
      this.materials.plastic = markRaw(new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, // 白色
        roughness: 0.4,
        metalness: 0.2
      }));
      this.materials.metal = markRaw(new THREE.MeshStandardMaterial({ 
        color: 0xCCCCCC, // 金属色
        roughness: 0.3,
        metalness: 0.7
      }));
    },
    createRooms() {
      const model = this.buildPlanModel()
      if (!model.rooms.length && !model.walls.length) {
        this.createFallbackScene()
        return
      }
      
      // 清空场景中的房间元素
      this.scene.children = this.scene.children.filter(child => 
        child.type === 'AmbientLight' || 
        child.type === 'DirectionalLight' || 
        child.type === 'PointLight' || 
        child.type === 'GridHelper'
      );
      
      this.createPlanFloor(model)
      this.createRoomFloors(model)
      this.createPlanWalls(model)
      this.createPlanOpenings(model)
      this.createRoomLabels(model)
      this.createFurnitureFromPlan(model)
      this.fitCameraToPlan(model)
    },
    buildPlanModel() {
      const rooms = this.getSourceRooms()
      const walls = this.getSourceWalls()
      const points = []

      rooms.forEach((room) => {
        points.push(
          { x: room.x, y: room.y },
          { x: room.x + room.width, y: room.y + room.length }
        )
      })

      walls.forEach((wall) => {
        points.push(wall.start, wall.end)
      })

      if (!points.length) {
        return { rooms: [], walls: [], bounds: null, scale: 1 }
      }

      const minX = Math.min(...points.map((point) => point.x))
      const minY = Math.min(...points.map((point) => point.y))
      const maxX = Math.max(...points.map((point) => point.x))
      const maxY = Math.max(...points.map((point) => point.y))
      const width = Math.max(maxX - minX, 1)
      const length = Math.max(maxY - minY, 1)
      const scale = Math.min(18 / Math.max(width, length), 0.035)

      const mapPoint = (point) => ({
        x: (point.x - minX - width / 2) * scale,
        z: (point.y - minY - length / 2) * scale
      })

      const mappedRooms = rooms.map((room, index) => {
        const start = mapPoint({ x: room.x, y: room.y })
        const end = mapPoint({ x: room.x + room.width, y: room.y + room.length })
        return {
          ...room,
          id: room.id || `room-${index + 1}`,
          name: room.name || `空间 ${index + 1}`,
          x: start.x,
          z: start.z,
          width: Math.max(Math.abs(end.x - start.x), 0.8),
          length: Math.max(Math.abs(end.z - start.z), 0.8),
          centerX: (start.x + end.x) / 2,
          centerZ: (start.z + end.z) / 2,
          furniture: room.furniture || []
        }
      })

      let mappedWalls = walls.map((wall, index) => {
        const start = mapPoint(wall.start)
        const end = mapPoint(wall.end)
        const length3d = Math.hypot(end.x - start.x, end.z - start.z)
        return {
          ...wall,
          id: wall.id || `wall-${index + 1}`,
          start,
          end,
          length3d,
          thickness3d: Math.max((Number(wall.thickness) || 12) * scale, wall.isExterior ? 0.16 : 0.08),
          isExterior: Boolean(wall.isExterior || wall.wallRole === 'exterior')
        }
      }).filter((wall) => wall.length3d > 0.18)

      mappedWalls = [...this.createBoundaryWalls({ minX, minY, maxX, maxY, mapPoint, scale }), ...mappedWalls]

      return {
        rooms: mappedRooms,
        walls: mappedWalls,
        openings: this.mapOpenings({ minX, minY, width, length, scale }),
        bounds: {
          width: width * scale,
          length: length * scale
        },
        scale
      }
    },
    mapOpenings({ minX, minY, width, length, scale }) {
      const mapPoint = (point) => ({
        x: (point.x - minX - width / 2) * scale,
        z: (point.y - minY - length / 2) * scale
      })

      return this.getSourceOpenings().map((opening, index) => {
        const point = mapPoint({
          x: Number(opening.position?.x ?? opening.x ?? 0),
          y: Number(opening.position?.y ?? opening.y ?? 0)
        })
        return {
          id: opening.id || `${opening.kind}-${index + 1}`,
          kind: opening.kind,
          position: point,
          width3d: Math.max(Number(opening.width || 90) * scale, opening.kind === 'door' ? 0.7 : 0.5)
        }
      })
    },
    getSourceRooms() {
      if (this.parseData?.rooms?.length) {
        return this.parseData.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          type: room.type,
          area: room.area,
          x: Number(room.position?.x ?? room.x ?? 0),
          y: Number(room.position?.y ?? room.y ?? 0),
          width: Number(room.width || 0),
          length: Number(room.length || room.height || 0)
        })).filter((room) => room.width > 0 && room.length > 0)
      }

      return (this.aiConfig?.rooms || this.sceneConfig?.rooms || []).map((room) => ({
        id: room.id,
        name: room.name,
        type: room.type,
        area: room.area,
        x: Number(room.bounds?.x || 0),
        y: Number(room.bounds?.y || 0),
        width: Number(room.bounds?.width || 0),
        length: Number(room.bounds?.height || room.bounds?.length || 0),
        furniture: room.furniture || []
      })).filter((room) => room.width > 0 && room.length > 0)
    },
    getSourceWalls() {
      if (this.parseData?.walls?.length) {
        return this.parseData.walls.map((wall) => ({
          id: wall.id,
          start: {
            x: Number(wall.start?.x || 0),
            y: Number(wall.start?.y || 0)
          },
          end: {
            x: Number(wall.end?.x || 0),
            y: Number(wall.end?.y || 0)
          },
          thickness: Number(wall.thickness || 12),
          isExterior: Boolean(wall.isExterior || wall.wallRole === 'exterior')
        }))
      }

      return (this.aiConfig?.structuralWallShells || this.sceneConfig?.structuralWallShells || []).map((wall) => {
        const bounds = wall.bounds || {}
        const x = Number(bounds.x || 0)
        const y = Number(bounds.y || 0)
        const wallWidth = Number(bounds.width || 0)
        const wallHeight = Number(bounds.height || 0)
        const horizontal = wallWidth >= wallHeight
        return {
          id: wall.id,
          start: horizontal
            ? { x, y: y + wallHeight / 2 }
            : { x: x + wallWidth / 2, y },
          end: horizontal
            ? { x: x + wallWidth, y: y + wallHeight / 2 }
            : { x: x + wallWidth / 2, y: y + wallHeight },
          thickness: Math.max(Math.min(wallWidth, wallHeight), 8),
          isExterior: wall.source === 'outer-contour' || wall.wallRole === 'exterior'
        }
      }).filter((wall) => wall.start && wall.end)
    },
    getSourceOpenings() {
      const parseOpenings = [
        ...(this.parseData?.doors || []).map((item) => ({ ...item, kind: 'door' })),
        ...(this.parseData?.windows || []).map((item) => ({ ...item, kind: 'window' }))
      ]
      if (parseOpenings.length) {
        return parseOpenings
      }

      const config = this.aiConfig || this.sceneConfig || {}
      return [
        ...(config.openings || []),
        ...(config.doors || []).map((item) => ({ ...item, kind: 'door' })),
        ...(config.windows || []).map((item) => ({ ...item, kind: 'window' }))
      ].map((item) => ({ ...item, kind: item.kind || item.type || 'door' }))
    },
    createBoundaryWalls({ minX, minY, maxX, maxY, mapPoint, scale }) {
      const corners = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
      ].map(mapPoint)

      return [
        [corners[0], corners[1]],
        [corners[1], corners[2]],
        [corners[2], corners[3]],
        [corners[3], corners[0]]
      ].map(([start, end], index) => ({
        id: `boundary-wall-${index + 1}`,
        start,
        end,
        length3d: Math.hypot(end.x - start.x, end.z - start.z),
        thickness3d: Math.max(18 * scale, 0.12),
        boundary: true,
        isExterior: true
      }))
    },
    createPlanFloor(model) {
      const floorGeometry = markRaw(new THREE.BoxGeometry(
        Math.max(model.bounds.width, 1),
        0.08,
        Math.max(model.bounds.length, 1)
      ))
      const floor = markRaw(new THREE.Mesh(floorGeometry, this.materials.floor))
      floor.position.set(0, -0.04, 0)
      floor.receiveShadow = true
      this.scene.add(floor)
    },
    createRoomFloors(model) {
      const roomMaterials = {
        living: 0xd7b988,
        bedroom: 0xc8a676,
        kitchen: 0xd8dee9,
        bathroom: 0xcbd5e1,
        dining: 0xd4a373,
        balcony: 0xb7c4b1,
        entry: 0xc9ada7
      }

      model.rooms.forEach((room) => {
        const key = Object.keys(roomMaterials).find((type) => (room.type || '').includes(type))
        const color = key ? roomMaterials[key] : this.materials.floor.color
        const material = markRaw(new THREE.MeshStandardMaterial({
          color,
          roughness: 0.74,
          metalness: 0.04
        }))
        const geometry = markRaw(new THREE.BoxGeometry(room.width, 0.045, room.length))
        const mesh = markRaw(new THREE.Mesh(geometry, material))
        mesh.position.set(room.centerX, 0.005, room.centerZ)
        mesh.receiveShadow = true
        this.scene.add(mesh)
      })
    },
    createPlanWalls(model) {
      const exteriorMaterial = this.materials.wall
      const interiorMaterial = markRaw(new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.82,
        metalness: 0.03
      }))

      model.walls.forEach((wall) => {
        const wallHeight = wall.isExterior ? 3 : 2.7
        const centerX = (wall.start.x + wall.end.x) / 2
        const centerZ = (wall.start.z + wall.end.z) / 2
        const angle = Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x)
        const geometry = markRaw(new THREE.BoxGeometry(
          wall.length3d,
          wallHeight,
          wall.thickness3d
        ))
        const mesh = markRaw(new THREE.Mesh(geometry, wall.isExterior ? exteriorMaterial : interiorMaterial))
        mesh.position.set(centerX, wallHeight / 2, centerZ)
        mesh.rotation.y = -angle
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.scene.add(mesh)
      })
    },
    createPlanOpenings(model) {
      if (!model.openings?.length || !model.walls?.length) {
        return
      }

      model.openings.forEach((opening) => {
        const nearestWall = this.findNearestWall(opening.position, model.walls)
        if (!nearestWall) {
          return
        }

        const angle = Math.atan2(nearestWall.end.z - nearestWall.start.z, nearestWall.end.x - nearestWall.start.x)
        const height = opening.kind === 'door' ? 2.05 : 0.9
        const y = opening.kind === 'door' ? height / 2 : 1.55
        const geometry = markRaw(new THREE.BoxGeometry(opening.width3d, height, 0.04))
        const material = opening.kind === 'door' ? this.materials.door : this.materials.window
        const mesh = markRaw(new THREE.Mesh(geometry, material))
        mesh.position.set(opening.position.x, y, opening.position.z)
        mesh.rotation.y = -angle
        mesh.castShadow = true
        this.scene.add(mesh)
      })
    },
    findNearestWall(point, walls) {
      let nearest = null
      let nearestDistance = Infinity

      walls.forEach((wall) => {
        const distance = this.distancePointToSegment(point, wall.start, wall.end)
        if (distance < nearestDistance) {
          nearest = wall
          nearestDistance = distance
        }
      })

      return nearestDistance < 1.2 ? nearest : null
    },
    distancePointToSegment(point, start, end) {
      const dx = end.x - start.x
      const dz = end.z - start.z
      const lengthSq = dx * dx + dz * dz
      if (lengthSq === 0) {
        return Math.hypot(point.x - start.x, point.z - start.z)
      }
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq))
      const projectedX = start.x + t * dx
      const projectedZ = start.z + t * dz
      return Math.hypot(point.x - projectedX, point.z - projectedZ)
    },
    createRoomLabels(model) {
      model.rooms.forEach((room) => {
        const markerGeometry = markRaw(new THREE.CircleGeometry(0.08, 24))
        const markerMaterial = markRaw(new THREE.MeshBasicMaterial({ color: 0x3b82f6 }))
        const marker = markRaw(new THREE.Mesh(markerGeometry, markerMaterial))
        marker.rotation.x = -Math.PI / 2
        marker.position.set(room.centerX, 0.012, room.centerZ)
        this.scene.add(marker)
      })
    },
    createFurnitureFromPlan(model) {
      model.rooms.slice(0, 8).forEach((room, index) => {
        if (room.furniture?.length) {
          room.furniture.slice(0, 4).forEach((item) => {
            this.createConfiguredRoomFurniture(room, item)
          })
          return
        }

        const type = room.type || ''
        if (type.includes('living') || room.name.includes('客厅') || index === 0) {
          this.createSimpleFurniture(room.centerX, room.centerZ, 'sofa')
        } else if (type.includes('kitchen') || room.name.includes('厨')) {
          this.createSimpleFurniture(room.centerX, room.centerZ, 'cabinet')
        } else if (type.includes('bath') || room.name.includes('卫')) {
          this.createSimpleFurniture(room.centerX, room.centerZ, 'bath')
        } else {
          this.createSimpleFurniture(room.centerX, room.centerZ, 'bed')
        }
      })
    },
    createConfiguredRoomFurniture(room, item) {
      const size = item.size || item.dimensions || {}
      const position = item.position || {}
      const width = this.clampFurnitureSize(Number(size.width || size.x || 0.9), room.width)
      const depth = this.clampFurnitureSize(Number(size.depth || size.z || 0.55), room.length)
      const height = Math.max(Number(size.height || size.y || 0.45), 0.12)
      const roomX = room.x + room.width * this.clamp01(Number(position.x ?? 0.5))
      const roomZ = room.z + room.length * this.clamp01(Number(position.z ?? position.y ?? 0.5))
      const material = this.materialForFurniture(item)
      const geometry = markRaw(new THREE.BoxGeometry(width, height, depth))
      const mesh = markRaw(new THREE.Mesh(geometry, material))
      mesh.position.set(roomX, height / 2, roomZ)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
    },
    clamp01(value) {
      if (!Number.isFinite(value)) {
        return 0.5
      }
      return Math.max(0.12, Math.min(0.88, value))
    },
    clampFurnitureSize(value, roomSize) {
      if (!Number.isFinite(value) || value <= 0) {
        return Math.min(roomSize * 0.38, 1.2)
      }
      return Math.max(0.18, Math.min(value, roomSize * 0.82))
    },
    materialForFurniture(item) {
      const type = item.type || ''
      const material = item.material || ''
      if (type.includes('sofa') || material.includes('linen') || material.includes('fabric')) {
        return this.materials.sofa
      }
      if (material.includes('steel') || material.includes('metal') || type.includes('stove')) {
        return this.materials.metal
      }
      if (material.includes('ceramic') || type.includes('sink') || type.includes('toilet')) {
        return this.materials.plastic
      }
      return this.materials.wood
    },
    createSimpleFurniture(x, z, type) {
      const geometryMap = {
        sofa: [1.4, 0.45, 0.7],
        bed: [1.2, 0.35, 1],
        cabinet: [1.2, 0.75, 0.35],
        bath: [0.6, 0.35, 0.8]
      }
      const [width, height, depth] = geometryMap[type] || geometryMap.bed
      const geometry = markRaw(new THREE.BoxGeometry(width, height, depth))
      const material = type === 'sofa' ? this.materials.sofa : this.materials.wood
      const mesh = markRaw(new THREE.Mesh(geometry, material))
      mesh.position.set(x, height / 2, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
    },
    fitCameraToPlan(model) {
      if (!this.camera || !this.controls || !model.bounds) {
        return
      }

      const distance = Math.max(model.bounds.width, model.bounds.length, 8)
      this.camera.position.set(0, distance * 0.95, distance * 1.15)
      this.camera.lookAt(0, 0, 0)
      this.controls.target.set(0, 0, 0)
      this.controls.update()
    },
    createFallbackScene() {
      const geometry = markRaw(new THREE.BoxGeometry(4, 0.2, 3))
      const mesh = markRaw(new THREE.Mesh(geometry, this.materials.floor))
      mesh.position.set(0, 0, 0)
      mesh.receiveShadow = true
      this.scene.add(mesh)
      this.camera.position.set(5, 4, 5)
      this.camera.lookAt(0, 0, 0)
    },
    createDoor(room, door, x, z) {
      const doorHeight = 2.1;
      const doorWidth = door.width || 0.9;
      const doorDepth = 0.05;
      
      // 门的位置
      const doorX = x - room.width / 2 + door.position.x;
      const doorZ = z - room.length / 2 + doorDepth / 2;
      
      // 创建门
      const doorGeometry = markRaw(new THREE.BoxGeometry(doorWidth, doorHeight, doorDepth));
      const doorMesh = markRaw(new THREE.Mesh(doorGeometry, this.materials.door));
      doorMesh.position.set(doorX, doorHeight / 2, doorZ);
      doorMesh.castShadow = true;
      doorMesh.receiveShadow = true;
      this.scene.add(doorMesh);
    },
    createWindow(room, window, x, z) {
      const windowHeight = 1.2;
      const windowWidth = window.width || 1.5;
      const windowDepth = 0.05;
      
      // 窗户的位置
      const windowX = x - room.width / 2 + window.position.x;
      const windowZ = z + room.length / 2 - windowDepth / 2;
      
      // 创建窗户
      const windowGeometry = markRaw(new THREE.BoxGeometry(windowWidth, windowHeight, windowDepth));
      const windowMesh = markRaw(new THREE.Mesh(windowGeometry, this.materials.window));
      windowMesh.position.set(windowX, windowHeight / 2 + 0.5, windowZ); // 窗户离地面0.5米
      windowMesh.castShadow = true;
      windowMesh.receiveShadow = true;
      this.scene.add(windowMesh);
    },
    createFurniture(room, x, z) {
      if (!room) {
        return
      }

      // 根据房间类型添加不同的家具
      switch (room.name) {
        case '客厅':
          this.createLivingRoomFurniture(room, x, z);
          break;
        case '卧室':
          this.createBedroomFurniture(room, x, z);
          break;
        case '厨房':
          this.createKitchenFurniture(room, x, z);
          break;
        case '卫生间':
          this.createBathroomFurniture(room, x, z);
          break;
        default:
          break;
      }
    },
    createLivingRoomFurniture(room, x, z) {
      // 沙发 - 组合沙发
      // 主沙发
      const sofaGeometry = markRaw(new THREE.BoxGeometry(2.5, 0.8, 1.2));
      const sofa = markRaw(new THREE.Mesh(sofaGeometry, this.materials.sofa));
      sofa.position.set(x, 0.4, z + room.length / 3);
      sofa.castShadow = true;
      sofa.receiveShadow = true;
      this.scene.add(sofa);
      
      // 沙发靠背
      const backrestGeometry = markRaw(new THREE.BoxGeometry(2.5, 0.8, 0.2));
      const backrest = markRaw(new THREE.Mesh(backrestGeometry, this.materials.sofa));
      backrest.position.set(x, 1.2, z + room.length / 3 + 0.6);
      backrest.castShadow = true;
      backrest.receiveShadow = true;
      this.scene.add(backrest);
      
      // 茶几 - 玻璃茶几
      const tableGeometry = markRaw(new THREE.BoxGeometry(1.2, 0.4, 0.8));
      const table = markRaw(new THREE.Mesh(tableGeometry, this.materials.wood));
      table.position.set(x, 0.2, z);
      table.castShadow = true;
      table.receiveShadow = true;
      this.scene.add(table);
      
      // 玻璃桌面
      const glassGeometry = markRaw(new THREE.BoxGeometry(1.1, 0.05, 0.7));
      const glass = markRaw(new THREE.Mesh(glassGeometry, markRaw(new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        transparent: true, 
        opacity: 0.7, 
        roughness: 0.1, 
        metalness: 0.3 
      }))));
      glass.position.set(x, 0.45, z);
      glass.castShadow = true;
      glass.receiveShadow = true;
      this.scene.add(glass);
      
      // 电视 - 现代电视
      const tvGeometry = markRaw(new THREE.BoxGeometry(1.2, 0.7, 0.05));
      const tv = markRaw(new THREE.Mesh(tvGeometry, markRaw(new THREE.MeshStandardMaterial({ color: 0x000000 }))));
      tv.position.set(x, 1.5, z - room.length / 2 + 0.15);
      tv.castShadow = true;
      tv.receiveShadow = true;
      this.scene.add(tv);
      
      // 电视支架
      const tvStandGeometry = markRaw(new THREE.BoxGeometry(1.4, 0.1, 0.4));
      const tvStand = markRaw(new THREE.Mesh(tvStandGeometry, this.materials.metal));
      tvStand.position.set(x, 0.75, z - room.length / 2 + 0.35);
      tvStand.castShadow = true;
      tvStand.receiveShadow = true;
      this.scene.add(tvStand);
      
      // 装饰画
      const paintingGeometry = markRaw(new THREE.BoxGeometry(0.8, 0.5, 0.02));
      const painting = markRaw(new THREE.Mesh(paintingGeometry, markRaw(new THREE.MeshStandardMaterial({ 
        color: 0x8B4513
      }))));
      painting.position.set(x, 1.8, z - room.length / 2 + 0.11);
      painting.castShadow = true;
      painting.receiveShadow = true;
      this.scene.add(painting);
    },
    createBedroomFurniture(room, x, z) {
      // 床 - 带床头板
      const bedGeometry = markRaw(new THREE.BoxGeometry(2, 0.5, 1.8));
      const bed = markRaw(new THREE.Mesh(bedGeometry, this.materials.wood));
      bed.position.set(x, 0.25, z + room.length / 3);
      bed.castShadow = true;
      bed.receiveShadow = true;
      this.scene.add(bed);
      
      // 床头板
      const headboardGeometry = markRaw(new THREE.BoxGeometry(2.2, 1, 0.2));
      const headboard = markRaw(new THREE.Mesh(headboardGeometry, this.materials.wood));
      headboard.position.set(x, 1, z + room.length / 3 + 0.9);
      headboard.castShadow = true;
      headboard.receiveShadow = true;
      this.scene.add(headboard);
      
      // 床头柜 - 两个
      const nightstandGeometry = markRaw(new THREE.BoxGeometry(0.6, 0.4, 0.5));
      const nightstand1 = markRaw(new THREE.Mesh(nightstandGeometry, this.materials.wood));
      nightstand1.position.set(x - 1.2, 0.2, z + room.length / 3 + 0.65);
      nightstand1.castShadow = true;
      nightstand1.receiveShadow = true;
      this.scene.add(nightstand1);
      
      const nightstand2 = markRaw(new THREE.Mesh(nightstandGeometry, this.materials.wood));
      nightstand2.position.set(x + 1.2, 0.2, z + room.length / 3 + 0.65);
      nightstand2.castShadow = true;
      nightstand2.receiveShadow = true;
      this.scene.add(nightstand2);
      
      // 台灯
      const lampGeometry = markRaw(new THREE.BoxGeometry(0.1, 0.4, 0.1));
      const lamp1 = markRaw(new THREE.Mesh(lampGeometry, this.materials.metal));
      lamp1.position.set(x - 1.2, 0.6, z + room.length / 3 + 0.65);
      lamp1.castShadow = true;
      lamp1.receiveShadow = true;
      this.scene.add(lamp1);
      
      const lamp2 = markRaw(new THREE.Mesh(lampGeometry, this.materials.metal));
      lamp2.position.set(x + 1.2, 0.6, z + room.length / 3 + 0.65);
      lamp2.castShadow = true;
      lamp2.receiveShadow = true;
      this.scene.add(lamp2);
      
      // 衣柜 - 带门
      const wardrobeGeometry = markRaw(new THREE.BoxGeometry(1.5, 2, 0.6));
      const wardrobe = markRaw(new THREE.Mesh(wardrobeGeometry, this.materials.wood));
      wardrobe.position.set(x, 1, z - room.length / 3);
      wardrobe.castShadow = true;
      wardrobe.receiveShadow = true;
      this.scene.add(wardrobe);
      
      // 衣柜门
      const doorGeometry = markRaw(new THREE.BoxGeometry(0.7, 1.8, 0.02));
      const door1 = markRaw(new THREE.Mesh(doorGeometry, this.materials.wood));
      door1.position.set(x - 0.4, 1, z - room.length / 3 - 0.29);
      door1.castShadow = true;
      door1.receiveShadow = true;
      this.scene.add(door1);
      
      const door2 = markRaw(new THREE.Mesh(doorGeometry, this.materials.wood));
      door2.position.set(x + 0.4, 1, z - room.length / 3 - 0.29);
      door2.castShadow = true;
      door2.receiveShadow = true;
      this.scene.add(door2);
    },
    createKitchenFurniture(room, x, z) {
      // 橱柜 - 底柜
      const cabinetGeometry = markRaw(new THREE.BoxGeometry(room.width - 0.5, 0.8, 0.6));
      const cabinet = markRaw(new THREE.Mesh(cabinetGeometry, this.materials.wood));
      cabinet.position.set(x, 0.4, z - room.length / 2 + 0.3);
      cabinet.castShadow = true;
      cabinet.receiveShadow = true;
      this.scene.add(cabinet);
      
      // 台面
      const countertopGeometry = markRaw(new THREE.BoxGeometry(room.width - 0.5, 0.1, 0.8));
      const countertop = markRaw(new THREE.Mesh(countertopGeometry, markRaw(new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF
      }))));
      countertop.position.set(x, 0.85, z - room.length / 2 + 0.4);
      countertop.castShadow = true;
      countertop.receiveShadow = true;
      this.scene.add(countertop);
      
      // 吊柜
      const upperCabinetGeometry = markRaw(new THREE.BoxGeometry(room.width - 0.5, 1, 0.6));
      const upperCabinet = markRaw(new THREE.Mesh(upperCabinetGeometry, this.materials.wood));
      upperCabinet.position.set(x, 2.3, z - room.length / 2 + 0.3);
      upperCabinet.castShadow = true;
      upperCabinet.receiveShadow = true;
      this.scene.add(upperCabinet);
      
      // 冰箱
      const fridgeGeometry = markRaw(new THREE.BoxGeometry(0.8, 1.8, 0.6));
      const fridge = markRaw(new THREE.Mesh(fridgeGeometry, markRaw(new THREE.MeshStandardMaterial({ color: 0xFFFFFF }))));
      fridge.position.set(x + room.width / 2 - 0.6, 0.9, z);
      fridge.castShadow = true;
      fridge.receiveShadow = true;
      this.scene.add(fridge);
      
      // 冰箱门
      const fridgeDoorGeometry = markRaw(new THREE.BoxGeometry(0.75, 1.7, 0.02));
      const fridgeDoor = markRaw(new THREE.Mesh(fridgeDoorGeometry, markRaw(new THREE.MeshStandardMaterial({ color: 0xFFFFFF }))));
      fridgeDoor.position.set(x + room.width / 2 - 0.6, 0.9, z - 0.29);
      fridgeDoor.castShadow = true;
      fridgeDoor.receiveShadow = true;
      this.scene.add(fridgeDoor);
      
      // 水槽
      const sinkGeometry = markRaw(new THREE.BoxGeometry(0.4, 0.05, 0.4));
      const sink = markRaw(new THREE.Mesh(sinkGeometry, markRaw(new THREE.MeshStandardMaterial({ color: 0xCCCCCC }))));
      sink.position.set(x - 1, 0.8, z - room.length / 2 + 0.4);
      sink.castShadow = true;
      sink.receiveShadow = true;
      this.scene.add(sink);
    },
    createBathroomFurniture(room, x, z) {
      // 马桶
      const toiletGeometry = markRaw(new THREE.BoxGeometry(0.6, 0.4, 0.8));
      const toilet = markRaw(new THREE.Mesh(toiletGeometry, markRaw(new THREE.MeshStandardMaterial({ color: 0xFFFFFF }))));
      toilet.position.set(x, 0.2, z + room.length / 3);
      toilet.castShadow = true;
      toilet.receiveShadow = true;
      this.scene.add(toilet);
      
      // 洗手盆 - 带柜子
      const sinkCabinetGeometry = markRaw(new THREE.BoxGeometry(0.8, 0.8, 0.6));
      const sinkCabinet = markRaw(new THREE.Mesh(sinkCabinetGeometry, this.materials.wood));
      sinkCabinet.position.set(x, 0.4, z - room.length / 3);
      sinkCabinet.castShadow = true;
      sinkCabinet.receiveShadow = true;
      this.scene.add(sinkCabinet);
      
      // 洗手盆
      const sinkGeometry = markRaw(new THREE.BoxGeometry(0.8, 0.1, 0.6));
      const sink = markRaw(new THREE.Mesh(sinkGeometry, markRaw(new THREE.MeshStandardMaterial({ color: 0xFFFFFF }))));
      sink.position.set(x, 0.8, z - room.length / 3);
      sink.castShadow = true;
      sink.receiveShadow = true;
      this.scene.add(sink);
      
      // 镜子
      const mirrorGeometry = markRaw(new THREE.BoxGeometry(1, 1.2, 0.02));
      const mirror = markRaw(new THREE.Mesh(mirrorGeometry, markRaw(new THREE.MeshStandardMaterial({ 
        color: 0xCCCCCC, 
        metalness: 0.8, 
        roughness: 0.1 
      }))));
      mirror.position.set(x, 1.4, z - room.length / 3 + 0.31);
      mirror.castShadow = true;
      mirror.receiveShadow = true;
      this.scene.add(mirror);
      
      // 淋浴间
      const showerGeometry = markRaw(new THREE.BoxGeometry(1.2, 2, 1.2));
      const shower = markRaw(new THREE.Mesh(showerGeometry, markRaw(new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        transparent: true, 
        opacity: 0.3, 
        roughness: 0.1, 
        metalness: 0.3 
      }))));
      shower.position.set(x, 1, z - room.length / 3 + 1.2);
      shower.castShadow = true;
      shower.receiveShadow = true;
      this.scene.add(shower);
    },
    animate() {
      this.animationId = requestAnimationFrame(() => this.animate());
      
      if (this.controls) {
        this.controls.update();
      }
      
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    },
    /**
     * 生成全景图
     * @returns {Promise<string>} 全景图数据URL
     */
    async generatePanorama() {
      if (!this.scene || !this.renderer) {
        throw new Error('场景未初始化');
      }
      
      try {
        console.log('开始生成全景图...');
        
        // 创建立方体贴图相机
        const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024);
        const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
        
        // 计算场景中心
        const center = new THREE.Vector3(0, 0, 0);
        if (this.parseData && this.parseData.rooms) {
          const rooms = this.parseData.rooms;
          let totalX = 0;
          let totalZ = 0;
          rooms.forEach(room => {
            const offsetX = room.width / 2 + (rooms.indexOf(room) * (room.width + 2));
            totalX += offsetX;
            totalZ += 0;
          });
          center.x = totalX / rooms.length;
          center.z = totalZ / rooms.length;
        }
        
        // 设置相机位置
        cubeCamera.position.copy(center);
        
        // 渲染六个方向
        cubeCamera.updateCubeMap(this.renderer, this.scene);
        
        // 创建全景图材质
        const panoramaMaterial = new THREE.ShaderMaterial({
          uniforms: {
            tCube: { value: cubeRenderTarget.texture }
          },
          vertexShader: `
            varying vec3 vNormal;
            void main() {
              vNormal = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform samplerCube tCube;
            varying vec3 vNormal;
            void main() {
              gl_FragColor = textureCube(tCube, normalize(vNormal));
            }
          `
        });
        
        // 创建全景图几何体
        const panoramaGeometry = new THREE.SphereGeometry(500, 60, 40);
        panoramaGeometry.scale(-1, 1, 1); // 翻转几何体
        
        // 创建全景图网格
        const panoramaMesh = new THREE.Mesh(panoramaGeometry, panoramaMaterial);
        
        // 创建临时场景
        const tempScene = new THREE.Scene();
        tempScene.add(panoramaMesh);
        
        // 创建临时相机
        const tempCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        tempCamera.position.set(0, 0, 0);
        
        // 渲染全景图
        this.renderer.setSize(1024, 1024);
        this.renderer.render(tempScene, tempCamera);
        
        // 生成数据URL
        const dataURL = this.renderer.domElement.toDataURL('image/jpeg');
        
        // 恢复原始大小
        const width = this.$refs.sceneContainer.clientWidth;
        const height = this.$refs.sceneContainer.clientHeight;
        this.renderer.setSize(width, height);
        
        console.log('全景图生成完成');
        return dataURL;
      } catch (error) {
        console.error('生成全景图失败:', error);
        // 失败时返回默认全景图
        return 'https://pannellum.org/images/alma.jpg';
      }
    }
  }
};
</script>

<style scoped>
/* 组件样式 */
</style>
