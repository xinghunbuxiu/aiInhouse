<template>
  <div class="p-4 bg-white rounded-lg shadow-md">
    <h3 class="text-lg font-semibold mb-4">设计方案管理</h3>
    
    <!-- 保存设计方案 -->
    <div class="mb-6">
      <h4 class="font-medium mb-2">保存当前设计</h4>
      <div class="flex gap-2">
        <input 
          type="text" 
          v-model="designName" 
          placeholder="设计方案名称" 
          class="flex-1 p-2 border border-gray-300 rounded-md"
        />
        <button 
          class="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors"
          @click="saveDesign"
          :disabled="!designName || loading"
        >
          <span v-if="loading" class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
          保存
        </button>
      </div>
      <div v-if="saveError" class="mt-2 text-red-500 text-sm">{{ saveError }}</div>
      <div v-if="saveSuccess" class="mt-2 text-green-500 text-sm">{{ saveSuccess }}</div>
    </div>
    
    <!-- 我的设计方案 -->
    <div class="mb-6">
      <h4 class="font-medium mb-2">我的设计方案</h4>
      <div v-if="designs.length === 0" class="text-gray-500">
        暂无设计方案，保存一个设计方案开始管理
      </div>
      <div v-else class="space-y-2">
        <div 
          v-for="design in designs" 
          :key="design.id"
          class="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          <div>
            <p class="font-medium">{{ design.name || `设计方案 ${design.id}` }}</p>
            <p class="text-xs text-gray-500">{{ new Date(design.createdAt).toLocaleString() }}</p>
          </div>
          <div class="flex gap-2">
            <button 
              class="text-indigo-600 hover:text-indigo-800 transition-colors"
              @click="loadDesign(design.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <button 
              class="text-green-600 hover:text-green-800 transition-colors"
              @click="shareDesign(design.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
            <button 
              class="text-red-600 hover:text-red-800 transition-colors"
              @click="deleteDesign(design.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 分享链接 -->
    <div v-if="shareUrl" class="mb-6">
      <h4 class="font-medium mb-2">分享链接</h4>
      <div class="flex gap-2">
        <input 
          type="text" 
          :value="shareUrl" 
          readonly 
          class="flex-1 p-2 border border-gray-300 rounded-md bg-gray-50"
        />
        <button 
          class="bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors"
          @click="copyShareUrl"
        >
          复制
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DesignManager',
  props: {
    parseData: {
      type: Object,
      default: null
    },
    materialData: {
      type: Object,
      default: () => ({})
    }
  },
  data() {
    return {
      designName: '',
      designs: [],
      shareUrl: '',
      loading: false,
      saveError: null,
      saveSuccess: null
    };
  },
  mounted() {
    this.loadDesigns();
  },
  methods: {
    async saveDesign() {
      if (!this.designName) {
        this.saveError = '请输入设计方案名称';
        return;
      }
      
      if (!this.parseData) {
        this.saveError = '暂无设计数据，请先上传平面图并处理';
        return;
      }
      
      this.saveError = null;
      this.saveSuccess = null;
      this.loading = true;
      
      try {
        const response = await fetch('/api/design/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId: 'user-1', // 实际项目中应该从认证信息中获取
            designData: {
              name: this.designName,
              parseData: this.parseData,
              materialData: this.materialData
            }
          })
        });
        
        if (!response.ok) {
          throw new Error('保存失败');
        }
        
        const data = await response.json();
        console.log('保存成功:', data);
        this.saveSuccess = '保存成功';
        this.designName = '';
        // 重新加载设计方案列表
        this.loadDesigns();
        // 3秒后隐藏成功信息
        setTimeout(() => {
          this.saveSuccess = null;
        }, 3000);
      } catch (error) {
        this.saveError = error.message;
        console.error('保存失败:', error);
      } finally {
        this.loading = false;
      }
    },
    async loadDesigns() {
      try {
        const response = await fetch('/api/design/user/user-1'); // 实际项目中应该从认证信息中获取
        if (!response.ok) {
          throw new Error('加载失败');
        }
        const data = await response.json();
        this.designs = data.data || [];
      } catch (error) {
        console.error('加载设计方案失败:', error);
      }
    },
    async loadDesign(designId) {
      try {
        const response = await fetch(`/api/design/${designId}`);
        if (!response.ok) {
          throw new Error('加载失败');
        }
        const data = await response.json();
        console.log('加载设计方案成功:', data);
        // 触发加载设计方案事件
        this.$emit('load-design', data.data);
      } catch (error) {
        console.error('加载设计方案失败:', error);
        alert('加载设计方案失败');
      }
    },
    async shareDesign(designId) {
      try {
        const response = await fetch(`/api/panorama/share/${designId}`);
        if (!response.ok) {
          throw new Error('获取分享链接失败');
        }
        const data = await response.json();
        this.shareUrl = data.shareUrl;
      } catch (error) {
        console.error('获取分享链接失败:', error);
        alert('获取分享链接失败');
      }
    },
    async deleteDesign(designId) {
      if (!confirm('确定要删除这个设计方案吗？')) {
        return;
      }
      
      try {
        const response = await fetch(`/api/design/${designId}`, {
          method: 'DELETE'
        });
        if (!response.ok) {
          throw new Error('删除失败');
        }
        console.log('删除成功');
        // 重新加载设计方案列表
        this.loadDesigns();
      } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败');
      }
    },
    copyShareUrl() {
      navigator.clipboard.writeText(this.shareUrl).then(() => {
        alert('链接已复制到剪贴板');
      }).catch(err => {
        console.error('复制失败:', err);
        alert('复制失败');
      });
    }
  }
};
</script>

<style scoped>
/* 组件样式 */
</style>