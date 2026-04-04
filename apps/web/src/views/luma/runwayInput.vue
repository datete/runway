<script setup lang="ts">
import { mlog } from '@/api';
import { runwayFeed, runwayFetch, runwayUpload } from '@/api/runway';
import { gptServerStore, homeStore } from '@/store';
import { useMessage,NInput,NButton, NTag,NSelect,NPopover,NSwitch } from 'naive-ui';
import { computed, onMounted, ref, watch } from 'vue';
import { SvgIcon } from '@/components/common';
import { t } from '@/locales';
import { RunwayTask } from '@/api/runwayStore';

const fsRef = ref<HTMLInputElement | null>(null);
const runway= ref<{image_prompt?:string,seed:number,text_prompt:string}>({image_prompt:'',seed:1675247627,text_prompt:''});
const st= ref({isDo:false,uploading:false, version:'gen2',time:5,image_as_end_frame:false});
const ms = useMessage();
const exRunway= ref<RunwayTask>()
async function selectFile(input: Event){
    const target = input.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;
    mlog("selectFile", file)

    st.value.uploading= true
    try{
      const d = await runwayUpload(file, 'DATASET_PREVIEW')
      mlog("runwayFetch",d)
      runway.value.image_prompt= d.url
    }catch(e :any){
      ms.error(e)
    } finally {
      st.value.uploading = false
    }
}
function getRandomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const canPost = computed(() => {
    return (runway.value.image_prompt !== '' || runway.value.text_prompt.trim() !== '' ) && !st.value.isDo
})

const generate= async ()=>{
    st.value.isDo= true
    //runway.value.seed= getRandomInt(1675247627, 3275247627)
    let seed= getRandomInt(1375247627, 3975247627);
    try{
        let obj={
            "taskType": "gen2",
            "internal": false,
            "options": {
                "name": `Gen-2 ${seed}`,
                "seconds": 4,
                "gen2Options": {
                "mode": "gen2",
                "seed": seed,
                "interpolate": true,
                "upscale": false,
                "watermark": true,
                "motion_score": 22,
                "use_motion_score": true,
                "use_motion_vectors": false,
                "text_prompt":  runway.value.text_prompt,
                "image_prompt": runway.value.image_prompt,
                "init_image": runway.value.image_prompt
                },
                "exploreMode": false,
                "assetGroupName": "Generative Video"
            },
           // "asTeamId": 17485144
        }

//         {
//   "name": "Gen-3 Alpha 2584627205, 笑起来, Cropped - cqkrcrc8j3",
//   "seconds": 5,
//   "text_prompt": "笑起来",
//   "seed": 2584627205,
//   "exploreMode": true,
//   "watermark": false,
//   "enhance_prompt": true,
//   "init_image": "https://d2jqrm6oza8nb6.cloudfront.net/previews/21fb66fc-c9d0-4c92-863d-623b77ab742b.webp?_jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJrZXlIYXNoIjoiNjI5MzQ4YTc0ODIwYWZiMiIsImJ1Y2tldCI6InJ1bndheS1kYXRhc2V0cyIsInN0YWdlIjoicHJvZCIsImV4cCI6MTcyMjY0MzIwMH0.x5f94vMk6Yt4dQTw4ueBnWOJ1EFRqOAp_vaLUcT5bs0",
//   "resolution": "720p",
//   "assetGroupName": "Generative Video"
// }
        let gen3= {
                "taskType": "europa",
                "internal": false,
                "options": {
                    "name": `Gen-3 Alpha  ${seed}`,
                    "seconds": st.value.time,
                    "text_prompt":runway.value.text_prompt,
                    "seed":seed,
                    "exploreMode": true,
                    "watermark": false,
                    "enhance_prompt": true,
                    "width": 1280,
                    "height": 768,
                    "image_as_end_frame": false,
                    "assetGroupName": "Generative Video",
                    "init_image": runway.value.image_prompt,
                    "resolution": '720p'// runway.value.image_prompt,
                    ,"extended_from_task_id":(exRunway.value&&exRunway.value.id)?exRunway.value.id:undefined
                    ,"init_video": ( exRunway.value && exRunway.value.artifacts && exRunway.value.artifacts[0].url)?exRunway.value.artifacts[0].url:undefined
                },
            //    "asTeamId": 17511575
        }
        let gen3_trubo=    {
                "taskType": "gen3a_turbo",
                "internal": false,
                "options": {
                    "name": `Gen-3 Alpha Turbo ${seed}`,
                    "seconds":st.value.time,
                    "text_prompt": runway.value.text_prompt ,
                    "seed": seed,
                    "exploreMode": false,
                    "watermark": false,
                    "enhance_prompt": true,
                    "init_image":  runway.value.image_prompt,
                    "resolution": "720p",
                    "image_as_end_frame": false,
                    "assetGroupName": "Generative Video"
                   ,"extended_from_task_id":(exRunway.value&&exRunway.value.id)?exRunway.value.id:undefined
                    ,"init_video": ( exRunway.value && exRunway.value.artifacts && exRunway.value.artifacts[0].url)?exRunway.value.artifacts[0].url:undefined
                }
        }
        let v_gen3={
            "taskType": "europa",
            "internal": false,
            "options": {
                "name": `Gen-3 Alpha  ${seed}`,
                "seconds": st.value.time,
                "text_prompt":runway.value.text_prompt,
                "seed":seed,
                "exploreMode": true,
                "watermark": false,
                "enhance_prompt": true,
                "video_prompt":  runway.value.image_prompt ,
                "structure_transformation": 0.3,
                "width": 1280,
                "height": 768,
                "assetGroupName": "Generative Video"
            }
        }


        if( obj.options.gen2Options.image_prompt==''){
            delete obj.options.gen2Options.image_prompt;
            delete obj.options.gen2Options.init_image;
        }
        if( gen3.options.init_image=='' ){
            delete gen3.options.init_image;
            delete gen3_trubo.options.init_image;
        }
        if( !gen3.options.init_video  ){
            delete gen3.options.init_video;
            delete gen3_trubo.options.init_video;
        }
        if( !gen3.options.extended_from_task_id  ){
            delete gen3.options.extended_from_task_id;
            delete gen3_trubo.options.extended_from_task_id;
        }
        gen3.options.image_as_end_frame=st.value.image_as_end_frame
        gen3_trubo.options.image_as_end_frame=st.value.image_as_end_frame

        gen3.options.exploreMode= st.value.version=='europa'
        v_gen3.options.exploreMode= st.value.version=='europa'
        let sobj:any = gen3;
        if(  st.value.version=='gen2' ){
            sobj= obj
        }
        if(  st.value.version=='gen3a_turbo' ){
            sobj= gen3_trubo
            if(gen3_trubo.options.init_image=='') {
                ms.error( t('video.gen3a_turbo_img') )
                return
            }
        }
        if(runway.value.image_prompt && isMp4(runway.value.image_prompt)){
            if( st.value.version=='gen2'){
                ms.error( 'gen2 不支持视频' )
                return
            }
            v_gen3.taskType='europa'
            if( st.value.version=='gen3a_turbo' ){
                v_gen3.taskType='gen3a_turbo'
            }
            sobj= v_gen3
        }
       // const d=  await runwayFetch('/tasks', st.value.version=='gen2'?obj: gen3 )
        const d=  await runwayFetch('/tasks',  sobj )
        mlog("runwayGen2",d)
        d.task && d.task.id&& runwayFeed(d.task.id)
    }catch(e:any){
        ms.error(e)
    } finally {
      st.value.isDo=false
    }

}
const isMp4=(url:string)=>{
    return /\.mp4(?:$|\?)/i.test(url)
}

const mvOption= [
{label: t('video.rwgen2'),value: 'gen2'}
,{label:t('video.rwgen3'),value: 'europa'}
,{label:t('video.rwgen3fast'),value: 'europa-fast'}
,{label:t('video.rwgen3turbo'),value: 'gen3a_turbo'}
 ]
 const timeOption= [
{label: 'Duration: 5s',value: 5}
,{label:'Duration: 10s',value: 10}
 ]



const clearInput=()=>{
    runway.value.image_prompt =''
    runway.value.text_prompt =''
    exRunway.value= undefined
    st.value.image_as_end_frame = false
}
const openFileDialog = () => fsRef.value?.click();
watch(()=>st.value.version,(n:string)=>{
    gptServerStore.setMyData({RRUNWAY_VERSION:n})
})
onMounted(() => {
    homeStore.setMyData({ms:ms})
    st.value.version= gptServerStore.myData.RRUNWAY_VERSION?gptServerStore.myData.RRUNWAY_VERSION: 'gen2'
});

watch(()=>homeStore.myData.act, (n)=>{
     if(n=='runway.extend'){
       mlog("runway.extend", homeStore.myData.actData )
       exRunway.value = homeStore.myData.actData as RunwayTask
     }
});
</script>

<template>
  <div class="rw-card rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4 flex flex-col gap-3">

    <!-- Version selector: pill segment control -->
    <div class="version-segment flex gap-1 bg-black/20 rounded-xl p-1">
      <button
        v-for="opt in mvOption"
        :key="opt.value"
        class="version-pill flex-1 text-xs font-medium px-2 py-1.5 rounded-lg transition-all duration-200 truncate"
        :class="st.version === opt.value
          ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-900/40'
          : 'text-white/50 hover:text-white/80 hover:bg-white/5'"
        @click="st.version = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>

    <!-- Textarea with character count -->
    <div class="relative">
      <n-input
        v-model:value="runway.text_prompt"
        :placeholder="$t('video.descpls')"
        type="textarea"
        size="medium"
        :autosize="{ minRows: 3, maxRows: 12 }"
        class="rw-textarea"
      />
      <span class="absolute bottom-2 right-3 text-[10px] text-white/30 pointer-events-none select-none">
        {{ runway.text_prompt.length }}
      </span>
    </div>

    <!-- Extend video card -->
    <div v-if="exRunway" class="extend-card rounded-xl overflow-hidden border border-violet-500/30 bg-violet-900/10">
      <div class="px-3 py-2 flex items-center gap-2 bg-violet-500/10">
        <SvgIcon icon="ri:video-add-line" class="text-violet-400 text-base flex-shrink-0" />
        <n-popover trigger="hover">
          <template #trigger>
            <span class="text-xs text-violet-200 line-clamp-1 cursor-default">
              {{ $t('video.extend') }}:
              <template v-if="exRunway.options.text_prompt">{{ exRunway.options.text_prompt }}</template>
              <template v-else>{{ exRunway.options.gen2Options?.text_prompt ? exRunway.options.gen2Options.text_prompt : exRunway.name }}</template>
            </span>
          </template>
          <div class="max-w-[300px] text-xs space-y-1">
            <div>ID: {{ exRunway.id }}</div>
            <div v-if="exRunway.taskType==='gen3a'">Version: Gen-3</div>
            <div v-if="exRunway.taskType==='gen3a_turbo'">Version: Gen-3-turbo</div>
            <div v-if="exRunway.taskType==='gen2'">Version: Gen-2</div>
            <div v-if="exRunway.createdAt">createdAt: {{ new Date(exRunway.createdAt).toLocaleString() }}</div>
            <div class="max-w-[300px]" v-if="exRunway.options.text_prompt">{{ exRunway.options.text_prompt }}</div>
            <div class="max-w-[300px]">{{ exRunway.options.gen2Options?.text_prompt ? exRunway.options.gen2Options.text_prompt : exRunway.name }}</div>
          </div>
        </n-popover>
      </div>
      <div class="relative aspect-[16/8.85] bg-black/30">
        <video
          v-if="exRunway.artifacts && exRunway.artifacts[0].url"
          loop playsinline controls
          referrerpolicy="no-referrer"
          :poster="exRunway.artifacts[0].previewUrls[0]"
          class="w-full h-full object-cover"
        >
          <source :src="exRunway.artifacts[0].url" referrerpolicy="no-referrer" type="video/mp4" />
        </video>
        <!-- gradient overlay -->
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
      </div>
    </div>

    <!-- Duration pill buttons (gen3+) -->
    <div v-if="st.version !== 'gen2'" class="flex gap-2 items-center">
      <span class="text-xs text-white/40 mr-1">Duration</span>
      <button
        v-for="opt in timeOption"
        :key="opt.value"
        class="duration-pill text-xs px-3 py-1 rounded-full border transition-all duration-200"
        :class="st.time === opt.value
          ? 'bg-indigo-600/80 border-indigo-400/60 text-white shadow-sm shadow-indigo-900/40'
          : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white/70 bg-white/5'"
        @click="st.time = opt.value"
      >
        {{ opt.value }}s
      </button>
    </div>

    <!-- Upload area + actions row -->
    <div class="flex items-end gap-3">

      <!-- Upload zone -->
      <div class="relative flex-shrink-0">
        <input
          type="file"
          @change="selectFile"
          ref="fsRef"
          class="hidden"
          accept="image/jpeg, image/jpg, image/png, image/gif, .mp4"
        />
        <div
          class="upload-zone h-[100px] w-[100px] rounded-xl border-2 border-dashed border-white/20 flex flex-col justify-center items-center cursor-pointer overflow-hidden relative transition-all duration-200 hover:border-violet-400/60 hover:scale-105 hover:bg-violet-900/20 bg-white/5"
          @click="openFileDialog"
        >
          <!-- uploading spinner -->
          <SvgIcon
            v-if="st.uploading"
            icon="line-md:uploading-loop"
            class="text-[48px] text-violet-300"
          />
          <!-- video preview -->
          <video
            v-else-if="runway.image_prompt && isMp4(runway.image_prompt)"
            loop playsinline
            referrerpolicy="no-referrer"
            class="w-full h-full object-cover"
          >
            <source :src="runway.image_prompt" referrerpolicy="no-referrer" type="video/mp4" />
          </video>
          <!-- image preview -->
          <img
            v-else-if="runway.image_prompt"
            :src="runway.image_prompt"
            class="w-full h-full object-cover"
          />
          <!-- placeholder -->
          <template v-else>
            <SvgIcon icon="mdi:image-plus" class="text-[28px] text-white/30 mb-1" />
            <span class="text-[10px] text-white/30 text-center leading-tight px-1">{{ $t('video.selectimg') }}</span>
          </template>

          <!-- gradient overlay when content present -->
          <div
            v-if="runway.image_prompt && !st.uploading"
            class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none"
          />
        </div>

        <!-- end/start frame switch -->
        <div class="absolute bottom-[-8px] right-[-12px]" v-if="runway.image_prompt && st.version !== 'gen2'">
          <a
            :href="runway.image_prompt"
            class="cursor-pointer"
            target="_blank"
            v-if="isMp4(runway.image_prompt)"
          >
            <NTag type="success" size="small" class="cursor-pointer" round :bordered="false">Video</NTag>
          </a>
          <NSwitch v-model:value="st.image_as_end_frame" size="small" v-else>
            <template #checked>尾帧</template>
            <template #unchecked>首帧</template>
          </NSwitch>
        </div>
      </div>

      <!-- Right side: clear + generate -->
      <div class="flex flex-col flex-1 gap-2 items-stretch">
        <!-- Clear ghost button -->
        <div class="flex justify-end">
          <NTag
            v-if="runway.text_prompt !== '' || runway.image_prompt !== '' || exRunway"
            type="success"
            size="small"
            round
          >
            <span class="cursor-pointer" @click="clearInput()">{{ $t('video.clear') }}</span>
          </NTag>
        </div>

        <!-- Generate button -->
        <NButton
          :loading="st.isDo"
          :disabled="!canPost"
          @click="generate()"
          class="generate-btn w-full"
          size="large"
        >
          <template #icon>
            <SvgIcon icon="ri:video-add-line" />
          </template>
          {{ $t('video.generate') }}
        </NButton>
      </div>
    </div>

    <!-- Info text -->
    <div class="text-[11px] text-white/30 leading-relaxed" v-html="$t('video.runwayinfo')" />

  </div>
</template>

<style scoped>
.rw-card {
  transition: box-shadow 0.2s ease;
}

/* Version segment pills */
.version-pill {
  outline: none;
  cursor: pointer;
}

/* Textarea focus ring animation */
.rw-textarea :deep(.n-input__textarea-el) {
  background: rgba(255,255,255,0.04) !important;
  border-radius: 10px;
  resize: none;
  transition: box-shadow 0.25s ease, background 0.2s ease;
}
.rw-textarea :deep(.n-input--focus .n-input__textarea-el),
.rw-textarea :deep(.n-input__textarea-el:focus) {
  box-shadow: 0 0 0 2px rgba(139,92,246,0.45);
  background: rgba(255,255,255,0.07) !important;
}
.rw-textarea :deep(.n-input) {
  --n-border: 1px solid rgba(255,255,255,0.08) !important;
  --n-border-hover: 1px solid rgba(139,92,246,0.4) !important;
  --n-border-focus: 1px solid rgba(139,92,246,0.6) !important;
}

/* Duration pill */
.duration-pill {
  outline: none;
  cursor: pointer;
}

/* Upload zone drag cue */
.upload-zone:active {
  transform: scale(0.97);
}

/* Generate button gradient */
.generate-btn :deep(.n-button__content) {
  display: flex;
  align-items: center;
  gap: 6px;
}
.generate-btn :deep(.n-button) {
  background: linear-gradient(135deg, #7c3aed, #4f46e5) !important;
  border: none !important;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 4px 18px rgba(99,60,220,0.35);
  transition: opacity 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}
.generate-btn :deep(.n-button:not(:disabled):hover) {
  opacity: 0.92;
  box-shadow: 0 6px 24px rgba(99,60,220,0.5);
  transform: translateY(-1px);
}
.generate-btn :deep(.n-button:not(:disabled):active) {
  transform: translateY(0);
}

/* Pulse when ready */
@keyframes readyPulse {
  0%, 100% { box-shadow: 0 4px 18px rgba(99,60,220,0.35); }
  50%       { box-shadow: 0 4px 28px rgba(139,92,246,0.65); }
}
.generate-btn:not([disabled]) :deep(.n-button) {
  animation: readyPulse 2.8s ease-in-out infinite;
}

/* Extend card slide-in */
.extend-card {
  animation: slideDown 0.25s ease;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
