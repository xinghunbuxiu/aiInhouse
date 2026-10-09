<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <div class="w-16 h-16 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
          {{ isLogin ? '登录' : '注册' }}
        </h2>
        <p class="mt-2 text-sm text-gray-600">
          {{ isLogin ? '请登录您的账户' : '创建一个新账户' }}
        </p>
      </div>

      <form class="mt-8 space-y-6" @submit.prevent="handleSubmit">
        <!-- 注册表单 -->
        <div v-if="!isLogin" class="rounded-md shadow-sm -space-y-px">
          <div>
            <label for="name" class="sr-only">姓名</label>
            <input
              id="name"
              name="name"
              type="text"
              required
              v-model="formData.name"
              class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="姓名"
            />
          </div>
        </div>

        <!-- 共用表单 -->
        <div class="rounded-md shadow-sm -space-y-px">
          <div>
            <label for="email" class="sr-only">邮箱</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              v-model="formData.email"
              class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="邮箱"
            />
          </div>
          <div>
            <label for="password" class="sr-only">密码</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              v-model="formData.password"
              class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="密码"
            />
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="error" class="bg-red-50 border border-red-200 rounded-md p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="ml-3">
              <p class="text-sm text-red-700">{{ error }}</p>
            </div>
          </div>
        </div>

        <!-- 提交按钮 -->
        <div>
          <button
            type="submit"
            :disabled="loading"
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <span v-if="loading" class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
            {{ isLogin ? '登录' : '注册' }}
          </button>
        </div>

        <!-- 切换登录/注册 -->
        <div class="text-center">
          <button
            type="button"
            @click="isLogin = !isLogin"
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-indigo-600 bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all"
          >
            {{ isLogin ? '没有账户？注册' : '已有账户？登录' }}
          </button>
        </div>

        <!-- 忘记密码 -->
        <div v-if="isLogin" class="text-center">
          <button
            type="button"
            @click="showForgotPassword = true"
            class="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
          >
            忘记密码？
          </button>
        </div>
      </form>

      <!-- 忘记密码表单 -->
      <div v-if="showForgotPassword" class="mt-8 space-y-6">
        <div class="text-center">
          <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
            重置密码
          </h2>
          <p class="mt-2 text-sm text-gray-600">
            请输入您的邮箱，我们会发送重置链接
          </p>
        </div>

        <form class="mt-8 space-y-6" @submit.prevent="handleForgotPassword">
          <div class="rounded-md shadow-sm">
            <div>
              <label for="forgot-email" class="sr-only">邮箱</label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                required
                v-model="forgotEmail"
                class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="邮箱"
              />
            </div>
          </div>

          <!-- 错误信息 -->
          <div v-if="forgotError" class="bg-red-50 border border-red-200 rounded-md p-4">
            <div class="flex">
              <div class="flex-shrink-0">
                <svg class="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="ml-3">
                <p class="text-sm text-red-700">{{ forgotError }}</p>
              </div>
            </div>
          </div>

          <!-- 成功信息 -->
          <div v-if="forgotSuccess" class="bg-green-50 border border-green-200 rounded-md p-4">
            <div class="flex">
              <div class="flex-shrink-0">
                <svg class="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="ml-3">
                <p class="text-sm text-green-700">{{ forgotSuccess }}</p>
              </div>
            </div>
          </div>

          <!-- 提交按钮 -->
          <div>
            <button
              type="submit"
              :disabled="forgotLoading"
              class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <span v-if="forgotLoading" class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
              发送重置链接
            </button>
          </div>

          <!-- 取消按钮 -->
          <div class="text-center">
            <button
              type="button"
              @click="showForgotPassword = false"
              class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-indigo-600 bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Auth',
  props: {
    initialMode: {
      type: String,
      default: 'login' // 'login' 或 'register'
    }
  },
  data() {
    return {
      isLogin: this.initialMode === 'login',
      showForgotPassword: false,
      loading: false,
      forgotLoading: false,
      error: null,
      forgotError: null,
      forgotSuccess: null,
      formData: {
        name: '',
        email: '',
        password: ''
      },
      forgotEmail: ''
    };
  },
  methods: {
    async handleSubmit() {
      this.error = null;
      this.loading = true;

      try {
        if (this.isLogin) {
          // 登录
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email: this.formData.email,
              password: this.formData.password
            })
          });

          if (!response.ok) {
            throw new Error('登录失败');
          }

          const data = await response.json();
          console.log('登录成功:', data);
          // 保存token
          localStorage.setItem('token', data.token);
          // 触发登录成功事件
          this.$emit('login-success', data.user);
        } else {
          // 注册
          const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: this.formData.name,
              email: this.formData.email,
              password: this.formData.password
            })
          });

          if (!response.ok) {
            throw new Error('注册失败');
          }

          const data = await response.json();
          console.log('注册成功:', data);
          // 保存token
          localStorage.setItem('token', data.token);
          // 触发登录成功事件
          this.$emit('login-success', data.user);
        }
      } catch (error) {
        this.error = error.message;
        console.error('认证失败:', error);
      } finally {
        this.loading = false;
      }
    },
    async handleForgotPassword() {
      this.forgotError = null;
      this.forgotSuccess = null;
      this.forgotLoading = true;

      try {
        const response = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: this.forgotEmail
          })
        });

        if (!response.ok) {
          throw new Error('发送重置链接失败');
        }

        this.forgotSuccess = '重置链接已发送，请检查您的邮箱';
        // 3秒后隐藏成功信息
        setTimeout(() => {
          this.showForgotPassword = false;
          this.forgotSuccess = null;
        }, 3000);
      } catch (error) {
        this.forgotError = error.message;
        console.error('发送重置链接失败:', error);
      } finally {
        this.forgotLoading = false;
      }
    }
  }
};
</script>

<style scoped>
/* 组件样式 */
</style>