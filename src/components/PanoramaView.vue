<template>
  <div class="w-full h-[500px] rounded-lg overflow-hidden shadow-md">
    <div v-if="!panoramaData" class="w-full h-full flex items-center justify-center bg-gray-100">
      <p class="text-gray-500">正在生成全景图...</p>
    </div>
    <div v-else ref="panoramaContainer" class="w-full h-full"></div>
  </div>
</template>

<script>
import { panoramaService } from '../services/panoramaService.js';

export default {
  name: 'PanoramaView',
  props: {
    sceneData: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      panoramaData: null
    };
  },
  watch: {
    sceneData: {
      handler(newData) {
        if (newData) {
          this.generatePanorama();
        }
      },
      immediate: true
    }
  },
  mounted() {
    if (this.sceneData) {
      this.generatePanorama();
    }
  },
  methods: {
    async generatePanorama() {
      try {
        // 使用全景图服务生成全景图
        const result = await panoramaService.generatePanorama(this.sceneData);
        
        // 验证全景图数据
        const validation = panoramaService.validatePanoramaData(result);
        if (!validation.valid) {
          throw new Error(validation.error);
        }
        
        this.panoramaData = result;
        this.initPanorama();
      } catch (error) {
        console.error('生成全景图失败:', error);
      }
    },
    initPanorama() {
      // 模拟全景图
      // 实际项目中，这里会从3D场景生成全景图
      const container = this.$refs.panoramaContainer;
      
      // 检查是否已经加载了Pannellum库
      if (window.pannellum) {
        this.createPanorama();
      } else {
        // 动态加载Pannellum库
        this.loadPannellum().then(() => {
          this.createPanorama();
        });
      }
    },
    loadPannellum() {
      return new Promise((resolve) => {
        // 加载Pannellum CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css';
        link.onload = () => {
          // 加载Pannellum JS
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js';
          script.onload = () => {
            resolve();
          };
          document.head.appendChild(script);
        };
        document.head.appendChild(link);
      });
    },
    createPanorama() {
      const container = this.$refs.panoramaContainer;
      
      // 使用从服务获取的全景图数据
      const panoramaConfig = {
        type: 'equirectangular',
        panorama: this.panoramaData.panoramaUrl,
        autoLoad: true,
        showControls: true,
        title: '全景效果图',
        author: 'AI InHouse',
        compass: true,
        northOffset: 90,
        showZoomCtrl: true,
        showFullscreenCtrl: true,
        showThumbs: false,
        showTitle: true,
        responsive: true,
        autoRotate: 2,
        userControls: true,
        clickToZoom: true,
        mouseZoom: true,
        hotSpots: this.panoramaData.hotspots || []
      };
      
      // 初始化Pannellum
      window.pannellum.viewer(container, panoramaConfig);
    }
  }
};
</script>

<style scoped>
/* 组件样式 */
</style>