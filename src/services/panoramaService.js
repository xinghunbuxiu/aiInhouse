/**
 * 全景图服务
 */
export const panoramaService = {
  /**
   * 生成全景图
   * @param {Object} sceneData - 3D场景数据
   * @returns {Promise<Object>} 全景图数据
   */
  async generatePanorama(sceneData) {
    try {
      console.log('开始生成全景图...');
      
      // 模拟生成全景图的过程
      // 实际项目中，这里会调用Three.js的立方体贴图生成全景图
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 返回模拟的全景图数据
      return {
        panoramaUrl: 'https://pannellum.org/images/alma.jpg',
        hotspots: [
          {
            pitch: -3,
            yaw: 117,
            type: 'scene',
            text: '客厅',
            target: 'living'
          },
          {
            pitch: -9,
            yaw: 285,
            type: 'scene',
            text: '主卧',
            target: 'bedroom1'
          },
          {
            pitch: -10,
            yaw: 340,
            type: 'scene',
            text: '厨房',
            target: 'kitchen'
          }
        ],
        cameraPositions: [
          {
            id: 'living',
            name: '客厅',
            position: { x: 3, y: 1.6, z: 2.5 }
          },
          {
            id: 'bedroom1',
            name: '主卧',
            position: { x: 9, y: 1.6, z: 2 }
          },
          {
            id: 'kitchen',
            name: '厨房',
            position: { x: 1.25, y: 1.6, z: 6.5 }
          }
        ]
      };
    } catch (error) {
      console.error('生成全景图失败:', error);
      // 返回默认全景图
      return {
        panoramaUrl: 'https://pannellum.org/images/alma.jpg',
        hotspots: [],
        cameraPositions: []
      };
    }
  },

  /**
   * 验证全景图数据
   * @param {Object} panoramaData - 全景图数据
   * @returns {Object} 验证结果
   */
  validatePanoramaData(panoramaData) {
    if (!panoramaData) {
      return { valid: false, error: '全景图数据为空' };
    }
    
    if (!panoramaData.panoramaUrl) {
      return { valid: false, error: '全景图URL为空' };
    }
    
    return { valid: true, error: null };
  },

  /**
   * 从3D场景生成全景图
   * @param {Object} threeScene - Three.js场景
   * @param {Object} camera - Three.js相机
   * @param {Object} renderer - Three.js渲染器
   * @returns {Promise<string>} 全景图数据URL
   */
  async generateFrom3DScene(threeScene, camera, renderer) {
    try {
      console.log('从3D场景生成全景图...');
      
      if (!threeScene || !camera || !renderer) {
        throw new Error('3D场景、相机或渲染器未初始化');
      }
      
      // 创建立方体贴图相机
      const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024);
      const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
      
      // 计算场景中心
      const center = new THREE.Vector3(0, 0, 0);
      
      // 设置相机位置
      cubeCamera.position.copy(center);
      
      // 渲染六个方向
      cubeCamera.updateCubeMap(renderer, threeScene);
      
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
      renderer.setSize(1024, 1024);
      renderer.render(tempScene, tempCamera);
      
      // 生成数据URL
      const dataURL = renderer.domElement.toDataURL('image/jpeg');
      
      // 恢复原始大小
      const width = renderer.domElement.clientWidth;
      const height = renderer.domElement.clientHeight;
      renderer.setSize(width, height);
      
      console.log('全景图生成完成');
      return dataURL;
    } catch (error) {
      console.error('从3D场景生成全景图失败:', error);
      // 返回默认全景图
      return 'https://pannellum.org/images/alma.jpg';
    }
  }
};