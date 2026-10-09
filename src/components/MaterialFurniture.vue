<template>
  <div class="p-4">
    <h3 class="text-lg font-semibold mb-4">材质和家具</h3>
    
    <!-- 风格选择 -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2">选择风格</label>
      <div class="flex flex-wrap gap-2">
        <button 
          v-for="style in styles" 
          :key="style.id"
          class="px-4 py-2 rounded-full text-sm font-medium transition-all"
          :class="selectedStyle === style.id ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'"
          @click="selectStyle(style.id)"
        >
          {{ style.name }}
        </button>
      </div>
    </div>
    
    <!-- 材质选择 -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2">选择材质</label>
      <div class="grid grid-cols-4 gap-4">
        <div 
          v-for="material in materials" 
          :key="material.id"
          class="border rounded-lg p-2 cursor-pointer transition-all"
          :class="selectedMaterials.includes(material.id) ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'"
          @click="toggleMaterial(material.id)"
        >
          <div class="w-full h-20 rounded" :style="{ backgroundColor: material.color }"></div>
          <p class="text-center text-sm mt-2">{{ material.name }}</p>
        </div>
      </div>
    </div>
    
    <!-- 家具布局 -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2">家具布局</label>
      <div class="grid grid-cols-2 gap-4">
        <div 
          v-for="layout in layouts" 
          :key="layout.id"
          class="border rounded-lg p-4 cursor-pointer transition-all"
          :class="selectedLayout === layout.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'"
          @click="selectLayout(layout.id)"
        >
          <h4 class="font-medium mb-2">{{ layout.name }}</h4>
          <p class="text-sm text-gray-600">{{ layout.description }}</p>
        </div>
      </div>
    </div>
    
    <!-- 应用按钮 -->
    <button 
      class="w-full bg-indigo-500 text-white py-2 px-4 rounded-lg font-medium hover:bg-indigo-600 transition-colors"
      @click="applyChanges"
    >
      应用更改
    </button>
  </div>
</template>

<script>
import { materialService } from '../services/materialService.js';

export default {
  name: 'MaterialFurniture',
  props: {
    modelValue: {
      type: Object,
      default: () => ({
        style: 'modern',
        materials: [],
        layout: 'default'
      })
    }
  },
  emits: ['update:modelValue', 'apply'],
  data() {
    return {
      styles: [],
      materials: [],
      layouts: [],
      selectedStyle: this.modelValue.style || 'modern',
      selectedMaterials: this.modelValue.materials || [],
      selectedLayout: this.modelValue.layout || 'default'
    };
  },
  async mounted() {
    await this.loadData();
  },
  methods: {
    async loadData() {
      await this.loadStyles();
      await this.loadMaterials();
      await this.loadLayouts();
    },
    async loadStyles() {
      this.styles = await materialService.getStyles();
    },
    async loadMaterials() {
      this.materials = await materialService.getMaterialsByStyle(this.selectedStyle);
    },
    async loadLayouts() {
      this.layouts = await materialService.getLayouts();
    },
    async selectStyle(styleId) {
      this.selectedStyle = styleId;
      await this.loadMaterials();
      this.selectedMaterials = [];
      this.updateModel();
    },
    toggleMaterial(materialId) {
      const index = this.selectedMaterials.indexOf(materialId);
      if (index > -1) {
        this.selectedMaterials.splice(index, 1);
      } else {
        this.selectedMaterials.push(materialId);
      }
      this.updateModel();
    },
    selectLayout(layoutId) {
      this.selectedLayout = layoutId;
      this.updateModel();
    },
    updateModel() {
      this.$emit('update:modelValue', {
        style: this.selectedStyle,
        materials: this.selectedMaterials,
        layout: this.selectedLayout
      });
    },
    async applyChanges() {
      const data = {
        style: this.selectedStyle,
        materials: this.selectedMaterials,
        layout: this.selectedLayout
      };
      
      try {
        const result = await materialService.applyMaterials(data);
        console.log('应用材质成功:', result);
        this.$emit('apply', data);
      } catch (error) {
        console.error('应用材质失败:', error);
      }
    }
  }
};
</script>

<style scoped>
/* 组件样式 */
</style>