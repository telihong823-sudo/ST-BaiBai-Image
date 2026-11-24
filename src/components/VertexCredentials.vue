<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import {
  clearVertexCredential,
  getVertexCredentialInfo,
  hasVertexCredential,
  importVertexCredential,
  loadVertexCredential,
} from '@/api/vertex';
import { computed, onMounted, ref } from 'vue';

const props = defineProps<{ channelId: string }>();
const emit = defineEmits<{ (event: 'busy-change', value: boolean): void }>();

const busy = ref(false);
const errorMsg = ref('');
const statusMsg = ref('');
const pastedCredential = ref('');
const importTab = ref<'file' | 'paste'>('file');
const showImporter = ref(false);
const dragging = ref(false);

const saved = computed(() => hasVertexCredential(props.channelId));
const info = computed(() => getVertexCredentialInfo(props.channelId));
const importerVisible = computed(() => !saved.value || showImporter.value);

async function updateCredential(operation: () => Promise<void>, successText = ''): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  emit('busy-change', true);
  errorMsg.value = '';
  statusMsg.value = '';
  try {
    await operation();
    if (successText) statusMsg.value = successText;
    return true;
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '无法操作 Vertex AI 凭证';
    return false;
  } finally {
    busy.value = false;
    emit('busy-change', false);
  }
}

async function importFromFile(file: File): Promise<void> {
  await updateCredential(async () => {
    const text = await file.text().catch(() => {
      throw new Error('无法读取凭证文件，可切换至「粘贴 JSON」导入');
    });
    await importVertexCredential(props.channelId, text);
    pastedCredential.value = '';
    showImporter.value = false;
  }, '凭证已导入');
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  void importFromFile(file);
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (busy.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) void importFromFile(file);
}

async function savePending(): Promise<boolean> {
  if (!pastedCredential.value.trim()) return true;
  return updateCredential(async () => {
    await importVertexCredential(props.channelId, pastedCredential.value);
    pastedCredential.value = '';
    showImporter.value = false;
  }, '凭证已导入');
}

function onClear() {
  void updateCredential(async () => {
    await clearVertexCredential(props.channelId);
    pastedCredential.value = '';
    showImporter.value = false;
  }, '已清除凭证');
}

defineExpose({ savePending });
onMounted(() => void updateCredential(() => loadVertexCredential(props.channelId)));
</script>

<template>
  <div class="vx-cred-card">
    <div class="vx-cred-head">
      <div class="vx-cred-title-group">
        <span class="vx-cred-title">服务账号凭证</span>
        <span class="vx-cred-badge" :class="{ 'is-saved': saved }">
          <span class="vx-cred-dot" aria-hidden="true"></span>
          {{ saved ? '已导入' : '未配置' }}
        </span>
      </div>
      <div v-if="saved" class="vx-cred-head-actions">
        <button
          class="vx-link-btn"
          type="button"
          :disabled="busy"
          @click="showImporter = !showImporter"
        >
          {{ showImporter ? '收起' : '更换凭证' }}
        </button>
        <button
          class="vx-link-btn is-danger"
          type="button"
          :disabled="busy"
          @click="onClear"
        >
          清除
        </button>
      </div>
    </div>

    <div v-if="saved && info" class="vx-cred-meta">
      <div class="vx-cred-meta-row">
        <span class="vx-cred-meta-key">项目</span>
        <span class="vx-cred-meta-val" :title="info.project">{{ info.project }}</span>
      </div>
      <div class="vx-cred-meta-row">
        <span class="vx-cred-meta-key">账号</span>
        <span class="vx-cred-meta-val" :title="info.email">{{ info.email }}</span>
      </div>
    </div>

    <div v-if="importerVisible" class="vx-cred-importer">
      <div class="vx-cred-tabs" role="tablist" aria-label="凭证导入方式">
        <button
          type="button"
          role="tab"
          class="vx-cred-tab"
          :class="{ 'is-on': importTab === 'file' }"
          :aria-selected="importTab === 'file'"
          :disabled="busy"
          @click="importTab = 'file'"
        >
          <Icon name="upload" :size="13" /> 上传文件
        </button>
        <button
          type="button"
          role="tab"
          class="vx-cred-tab"
          :class="{ 'is-on': importTab === 'paste' }"
          :aria-selected="importTab === 'paste'"
          :disabled="busy"
          @click="importTab = 'paste'"
        >
          <Icon name="text" :size="13" /> 粘贴 JSON
        </button>
      </div>

      <label
        v-if="importTab === 'file'"
        class="vx-dropzone"
        :class="{ 'is-drag': dragging, 'is-busy': busy }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <!-- 安卓文件选择器可能把 JSON 当成纯文本或通用文件，不限 accept，导入时按内容校验。 -->
        <input class="vx-file-hidden" type="file" :disabled="busy" @change="onFileChange" />
        <Icon name="upload" :size="18" class="vx-dropzone-icon" />
        <span class="vx-dropzone-main">{{ busy ? '正在导入凭证…' : '选择或拖入服务账号 JSON 文件' }}</span>
        <span class="vx-dropzone-sub">Google Cloud 导出的 Service Account 密钥，仅存本机</span>
      </label>

      <div v-else class="vx-paste-box">
        <textarea
          v-model="pastedCredential"
          class="bbi-input vx-paste-area"
          rows="4"
          placeholder='{"type": "service_account", "project_id": "...", ...}'
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :disabled="busy"
        />
        <div class="vx-paste-foot">
          <span class="vx-paste-tip">点「保存凭证」或底部「完成」均可导入</span>
          <button
            class="bbi-btn bbi-btn-primary bbi-btn-sm"
            type="button"
            :disabled="busy || !pastedCredential.trim()"
            @click="savePending"
          >
            <Icon name="check" :size="13" /> 保存凭证
          </button>
        </div>
      </div>
    </div>

    <p v-if="errorMsg" class="vx-cred-notice is-error" role="alert">{{ errorMsg }}</p>
    <p v-else-if="statusMsg" class="vx-cred-notice is-ok" role="status">{{ statusMsg }}</p>
  </div>
</template>

<style scoped>
.vx-cred-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius);
  background: var(--bbi-surface-2);
}

.vx-cred-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vx-cred-title-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.vx-cred-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--bbi-ink);
}

.vx-cred-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: var(--bbi-radius-pill);
  font-size: 11px;
  font-weight: 600;
  color: var(--bbi-ink-muted);
  background: var(--bbi-surface);
  border: 1px solid var(--bbi-line);
}

.vx-cred-badge.is-saved {
  color: var(--bbi-accent);
  background: var(--bbi-accent-soft);
  border-color: transparent;
}

.vx-cred-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.vx-cred-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.vx-link-btn {
  padding: 3px 8px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface);
  color: var(--bbi-ink-soft);
  font-family: var(--bbi-font-sans);
  font-size: 11.5px;
  cursor: pointer;
  transition:
    color var(--bbi-dur) var(--bbi-ease),
    border-color var(--bbi-dur) var(--bbi-ease),
    background var(--bbi-dur) var(--bbi-ease);
}

.vx-link-btn:hover {
  color: var(--bbi-accent);
  border-color: var(--bbi-accent);
}

.vx-link-btn.is-danger:hover {
  color: var(--bbi-danger);
  border-color: var(--bbi-danger);
  background: var(--bbi-danger-soft);
}

.vx-link-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.vx-cred-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface);
  border: 1px solid var(--bbi-line);
}

.vx-cred-meta-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}

.vx-cred-meta-key {
  flex: 0 0 auto;
  color: var(--bbi-ink-muted);
  font-size: 11.5px;
}

.vx-cred-meta-val {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--bbi-font-mono);
  font-size: 11.5px;
  color: var(--bbi-ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vx-cred-importer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vx-cred-tabs {
  display: inline-flex;
  align-self: flex-start;
  gap: 3px;
  padding: 3px;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface);
  border: 1px solid var(--bbi-line);
}

.vx-cred-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bbi-ink-soft);
  font-family: var(--bbi-font-sans);
  font-size: 12px;
  cursor: pointer;
  transition:
    background var(--bbi-dur) var(--bbi-ease),
    color var(--bbi-dur) var(--bbi-ease);
}

.vx-cred-tab:hover {
  color: var(--bbi-ink);
}

.vx-cred-tab.is-on {
  background: var(--bbi-accent-soft);
  color: var(--bbi-accent);
  font-weight: 600;
}

.vx-dropzone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 16px 12px;
  border: 1.5px dashed var(--bbi-line-strong);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface);
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--bbi-dur) var(--bbi-ease),
    background var(--bbi-dur) var(--bbi-ease);
}

.vx-dropzone:hover,
.vx-dropzone.is-drag {
  border-color: var(--bbi-accent);
  background: var(--bbi-accent-soft);
}

.vx-dropzone.is-busy {
  opacity: 0.65;
  cursor: wait;
}

.vx-file-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.vx-dropzone-icon {
  color: var(--bbi-accent);
}

.vx-dropzone-main {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--bbi-ink);
}

.vx-dropzone-sub {
  font-size: 11px;
  color: var(--bbi-ink-muted);
}

.vx-paste-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vx-paste-area {
  font-family: var(--bbi-font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  resize: vertical;
  min-height: 84px;
}

.vx-paste-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vx-paste-tip {
  font-size: 11px;
  color: var(--bbi-ink-muted);
}

.vx-cred-notice {
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--bbi-radius-sm);
  font-size: 12px;
  line-height: 1.45;
}

.vx-cred-notice.is-error {
  color: var(--bbi-danger);
  background: var(--bbi-danger-soft);
}

.vx-cred-notice.is-ok {
  color: var(--bbi-accent);
  background: var(--bbi-accent-soft);
}
</style>
