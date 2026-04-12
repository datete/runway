import{d as T,K as D,ci as ce,Q as t,bD as Z,bH as ee,bE as te,bF as re,bG as ie,bN as q,C as E,D as b,bt as W,G as de,J as oe,bx as V,M as ue,cj as ge,c4 as se,ac as pe,o as j,c as A,F as ae,r as ne,f as u,t as B,n as H,g as fe,A as he,s as z,w as M,u as le,l as G,e as P,b as k,i as d,af as X,j as Q,ar as ve,ck as ye,cl as K,T as U,bS as me,cm as be,cn as we,co as xe,aV as $e,aX as Ce,ai as ke,bU as Se}from"./index-3c8001ab.js";const Pe={success:t(ee,null),error:t(te,null),warning:t(re,null),info:t(ie,null)},_e=T({name:"ProgressCircle",props:{clsPrefix:{type:String,required:!0},status:{type:String,required:!0},strokeWidth:{type:Number,required:!0},fillColor:[String,Object],railColor:String,railStyle:[String,Object],percentage:{type:Number,default:0},offsetDegree:{type:Number,default:0},showIndicator:{type:Boolean,required:!0},indicatorTextColor:String,unit:String,viewBoxWidth:{type:Number,required:!0},gapDegree:{type:Number,required:!0},gapOffsetDegree:{type:Number,default:0}},setup(e,{slots:o}){const s=D(()=>{const l="gradient",{fillColor:a}=e;return typeof a=="object"?`${l}-${ce(JSON.stringify(a))}`:l});function h(l,a,r,c){const{gapDegree:p,viewBoxWidth:w,strokeWidth:x}=e,g=50,y=0,i=g,n=0,$=2*g,C=50+x/2,S=`M ${C},${C} m ${y},${i}
      a ${g},${g} 0 1 1 ${n},${-$}
      a ${g},${g} 0 1 1 ${-n},${$}`,_=Math.PI*2*g,R={stroke:c==="rail"?r:typeof e.fillColor=="object"?`url(#${s.value})`:r,strokeDasharray:`${Math.min(l,100)/100*(_-p)}px ${w*8}px`,strokeDashoffset:`-${p/2}px`,transformOrigin:a?"center":void 0,transform:a?`rotate(${a}deg)`:void 0};return{pathString:S,pathStyle:R}}const f=()=>{const l=typeof e.fillColor=="object",a=l?e.fillColor.stops[0]:"",r=l?e.fillColor.stops[1]:"";return l&&t("defs",null,t("linearGradient",{id:s.value,x1:"0%",y1:"100%",x2:"100%",y2:"0%"},t("stop",{offset:"0%","stop-color":a}),t("stop",{offset:"100%","stop-color":r})))};return()=>{const{fillColor:l,railColor:a,strokeWidth:r,offsetDegree:c,status:p,percentage:w,showIndicator:x,indicatorTextColor:g,unit:y,gapOffsetDegree:i,clsPrefix:n}=e,{pathString:$,pathStyle:C}=h(100,0,a,"rail"),{pathString:S,pathStyle:_}=h(w,c,l,"fill"),R=100+r;return t("div",{class:`${n}-progress-content`,role:"none"},t("div",{class:`${n}-progress-graph`,"aria-hidden":!0},t("div",{class:`${n}-progress-graph-circle`,style:{transform:i?`rotate(${i}deg)`:void 0}},t("svg",{viewBox:`0 0 ${R} ${R}`},f(),t("g",null,t("path",{class:`${n}-progress-graph-circle-rail`,d:$,"stroke-width":r,"stroke-linecap":"round",fill:"none",style:C})),t("g",null,t("path",{class:[`${n}-progress-graph-circle-fill`,w===0&&`${n}-progress-graph-circle-fill--empty`],d:S,"stroke-width":r,"stroke-linecap":"round",fill:"none",style:_}))))),x?t("div",null,o.default?t("div",{class:`${n}-progress-custom-content`,role:"none"},o.default()):p!=="default"?t("div",{class:`${n}-progress-icon`,"aria-hidden":!0},t(Z,{clsPrefix:n},{default:()=>Pe[p]})):t("div",{class:`${n}-progress-text`,style:{color:g},role:"none"},t("span",{class:`${n}-progress-text__percentage`},w),t("span",{class:`${n}-progress-text__unit`},y))):null)}}}),Ne={success:t(ee,null),error:t(te,null),warning:t(re,null),info:t(ie,null)},Be=T({name:"ProgressLine",props:{clsPrefix:{type:String,required:!0},percentage:{type:Number,default:0},railColor:String,railStyle:[String,Object],fillColor:[String,Object],status:{type:String,required:!0},indicatorPlacement:{type:String,required:!0},indicatorTextColor:String,unit:{type:String,default:"%"},processing:{type:Boolean,required:!0},showIndicator:{type:Boolean,required:!0},height:[String,Number],railBorderRadius:[String,Number],fillBorderRadius:[String,Number]},setup(e,{slots:o}){const s=D(()=>q(e.height)),h=D(()=>{var a,r;return typeof e.fillColor=="object"?`linear-gradient(to right, ${(a=e.fillColor)===null||a===void 0?void 0:a.stops[0]} , ${(r=e.fillColor)===null||r===void 0?void 0:r.stops[1]})`:e.fillColor}),f=D(()=>e.railBorderRadius!==void 0?q(e.railBorderRadius):e.height!==void 0?q(e.height,{c:.5}):""),l=D(()=>e.fillBorderRadius!==void 0?q(e.fillBorderRadius):e.railBorderRadius!==void 0?q(e.railBorderRadius):e.height!==void 0?q(e.height,{c:.5}):"");return()=>{const{indicatorPlacement:a,railColor:r,railStyle:c,percentage:p,unit:w,indicatorTextColor:x,status:g,showIndicator:y,processing:i,clsPrefix:n}=e;return t("div",{class:`${n}-progress-content`,role:"none"},t("div",{class:`${n}-progress-graph`,"aria-hidden":!0},t("div",{class:[`${n}-progress-graph-line`,{[`${n}-progress-graph-line--indicator-${a}`]:!0}]},t("div",{class:`${n}-progress-graph-line-rail`,style:[{backgroundColor:r,height:s.value,borderRadius:f.value},c]},t("div",{class:[`${n}-progress-graph-line-fill`,i&&`${n}-progress-graph-line-fill--processing`],style:{maxWidth:`${e.percentage}%`,background:h.value,height:s.value,lineHeight:s.value,borderRadius:l.value}},a==="inside"?t("div",{class:`${n}-progress-graph-line-indicator`,style:{color:x}},o.default?o.default():`${p}${w}`):null)))),y&&a==="outside"?t("div",null,o.default?t("div",{class:`${n}-progress-custom-content`,style:{color:x},role:"none"},o.default()):g==="default"?t("div",{role:"none",class:`${n}-progress-icon ${n}-progress-icon--as-text`,style:{color:x}},p,w):t("div",{class:`${n}-progress-icon`,"aria-hidden":!0},t(Z,{clsPrefix:n},{default:()=>Ne[g]}))):null)}}});function Y(e,o,s=100){return`m ${s/2} ${s/2-e} a ${e} ${e} 0 1 1 0 ${2*e} a ${e} ${e} 0 1 1 0 -${2*e}`}const ze=T({name:"ProgressMultipleCircle",props:{clsPrefix:{type:String,required:!0},viewBoxWidth:{type:Number,required:!0},percentage:{type:Array,default:[0]},strokeWidth:{type:Number,required:!0},circleGap:{type:Number,required:!0},showIndicator:{type:Boolean,required:!0},fillColor:{type:Array,default:()=>[]},railColor:{type:Array,default:()=>[]},railStyle:{type:Array,default:()=>[]}},setup(e,{slots:o}){const s=D(()=>e.percentage.map((l,a)=>`${Math.PI*l/100*(e.viewBoxWidth/2-e.strokeWidth/2*(1+2*a)-e.circleGap*a)*2}, ${e.viewBoxWidth*8}`)),h=(f,l)=>{const a=e.fillColor[l],r=typeof a=="object"?a.stops[0]:"",c=typeof a=="object"?a.stops[1]:"";return typeof e.fillColor[l]=="object"&&t("linearGradient",{id:`gradient-${l}`,x1:"100%",y1:"0%",x2:"0%",y2:"100%"},t("stop",{offset:"0%","stop-color":r}),t("stop",{offset:"100%","stop-color":c}))};return()=>{const{viewBoxWidth:f,strokeWidth:l,circleGap:a,showIndicator:r,fillColor:c,railColor:p,railStyle:w,percentage:x,clsPrefix:g}=e;return t("div",{class:`${g}-progress-content`,role:"none"},t("div",{class:`${g}-progress-graph`,"aria-hidden":!0},t("div",{class:`${g}-progress-graph-circle`},t("svg",{viewBox:`0 0 ${f} ${f}`},t("defs",null,x.map((y,i)=>h(y,i))),x.map((y,i)=>t("g",{key:i},t("path",{class:`${g}-progress-graph-circle-rail`,d:Y(f/2-l/2*(1+2*i)-a*i,l,f),"stroke-width":l,"stroke-linecap":"round",fill:"none",style:[{strokeDashoffset:0,stroke:p[i]},w[i]]}),t("path",{class:[`${g}-progress-graph-circle-fill`,y===0&&`${g}-progress-graph-circle-fill--empty`],d:Y(f/2-l/2*(1+2*i)-a*i,l,f),"stroke-width":l,"stroke-linecap":"round",fill:"none",style:{strokeDasharray:s.value[i],strokeDashoffset:0,stroke:typeof c[i]=="object"?`url(#gradient-${i})`:c[i]}})))))),r&&o.default?t("div",null,t("div",{class:`${g}-progress-text`},o.default())):null)}}}),De=E([b("progress",{display:"inline-block"},[b("progress-icon",`
 color: var(--n-icon-color);
 transition: color .3s var(--n-bezier);
 `),W("line",`
 width: 100%;
 display: block;
 `,[b("progress-content",`
 display: flex;
 align-items: center;
 `,[b("progress-graph",{flex:1})]),b("progress-custom-content",{marginLeft:"14px"}),b("progress-icon",`
 width: 30px;
 padding-left: 14px;
 height: var(--n-icon-size-line);
 line-height: var(--n-icon-size-line);
 font-size: var(--n-icon-size-line);
 `,[W("as-text",`
 color: var(--n-text-color-line-outer);
 text-align: center;
 width: 40px;
 font-size: var(--n-font-size);
 padding-left: 4px;
 transition: color .3s var(--n-bezier);
 `)])]),W("circle, dashboard",{width:"120px"},[b("progress-custom-content",`
 position: absolute;
 left: 50%;
 top: 50%;
 transform: translateX(-50%) translateY(-50%);
 display: flex;
 align-items: center;
 justify-content: center;
 `),b("progress-text",`
 position: absolute;
 left: 50%;
 top: 50%;
 transform: translateX(-50%) translateY(-50%);
 display: flex;
 align-items: center;
 color: inherit;
 font-size: var(--n-font-size-circle);
 color: var(--n-text-color-circle);
 font-weight: var(--n-font-weight-circle);
 transition: color .3s var(--n-bezier);
 white-space: nowrap;
 `),b("progress-icon",`
 position: absolute;
 left: 50%;
 top: 50%;
 transform: translateX(-50%) translateY(-50%);
 display: flex;
 align-items: center;
 color: var(--n-icon-color);
 font-size: var(--n-icon-size-circle);
 `)]),W("multiple-circle",`
 width: 200px;
 color: inherit;
 `,[b("progress-text",`
 font-weight: var(--n-font-weight-circle);
 color: var(--n-text-color-circle);
 position: absolute;
 left: 50%;
 top: 50%;
 transform: translateX(-50%) translateY(-50%);
 display: flex;
 align-items: center;
 justify-content: center;
 transition: color .3s var(--n-bezier);
 `)]),b("progress-content",{position:"relative"}),b("progress-graph",{position:"relative"},[b("progress-graph-circle",[E("svg",{verticalAlign:"bottom"}),b("progress-graph-circle-fill",`
 stroke: var(--n-fill-color);
 transition:
 opacity .3s var(--n-bezier),
 stroke .3s var(--n-bezier),
 stroke-dasharray .3s var(--n-bezier);
 `,[W("empty",{opacity:0})]),b("progress-graph-circle-rail",`
 transition: stroke .3s var(--n-bezier);
 overflow: hidden;
 stroke: var(--n-rail-color);
 `)]),b("progress-graph-line",[W("indicator-inside",[b("progress-graph-line-rail",`
 height: 16px;
 line-height: 16px;
 border-radius: 10px;
 `,[b("progress-graph-line-fill",`
 height: inherit;
 border-radius: 10px;
 `),b("progress-graph-line-indicator",`
 background: #0000;
 white-space: nowrap;
 text-align: right;
 margin-left: 14px;
 margin-right: 14px;
 height: inherit;
 font-size: 12px;
 color: var(--n-text-color-line-inner);
 transition: color .3s var(--n-bezier);
 `)])]),W("indicator-inside-label",`
 height: 16px;
 display: flex;
 align-items: center;
 `,[b("progress-graph-line-rail",`
 flex: 1;
 transition: background-color .3s var(--n-bezier);
 `),b("progress-graph-line-indicator",`
 background: var(--n-fill-color);
 font-size: 12px;
 transform: translateZ(0);
 display: flex;
 vertical-align: middle;
 height: 16px;
 line-height: 16px;
 padding: 0 10px;
 border-radius: 10px;
 position: absolute;
 white-space: nowrap;
 color: var(--n-text-color-line-inner);
 transition:
 right .2s var(--n-bezier),
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 `)]),b("progress-graph-line-rail",`
 position: relative;
 overflow: hidden;
 height: var(--n-rail-height);
 border-radius: 5px;
 background-color: var(--n-rail-color);
 transition: background-color .3s var(--n-bezier);
 `,[b("progress-graph-line-fill",`
 background: var(--n-fill-color);
 position: relative;
 border-radius: 5px;
 height: inherit;
 width: 100%;
 max-width: 0%;
 transition:
 background-color .3s var(--n-bezier),
 max-width .2s var(--n-bezier);
 `,[W("processing",[E("&::after",`
 content: "";
 background-image: var(--n-line-bg-processing);
 animation: progress-processing-animation 2s var(--n-bezier) infinite;
 `)])])])])])]),E("@keyframes progress-processing-animation",`
 0% {
 position: absolute;
 left: 0;
 top: 0;
 bottom: 0;
 right: 100%;
 opacity: 1;
 }
 66% {
 position: absolute;
 left: 0;
 top: 0;
 bottom: 0;
 right: 0;
 opacity: 0;
 }
 100% {
 position: absolute;
 left: 0;
 top: 0;
 bottom: 0;
 right: 0;
 opacity: 0;
 }
 `)]),Re=Object.assign(Object.assign({},oe.props),{processing:Boolean,type:{type:String,default:"line"},gapDegree:Number,gapOffsetDegree:Number,status:{type:String,default:"default"},railColor:[String,Array],railStyle:[String,Array],color:[String,Array,Object],viewBoxWidth:{type:Number,default:100},strokeWidth:{type:Number,default:7},percentage:[Number,Array],unit:{type:String,default:"%"},showIndicator:{type:Boolean,default:!0},indicatorPosition:{type:String,default:"outside"},indicatorPlacement:{type:String,default:"outside"},indicatorTextColor:String,circleGap:{type:Number,default:1},height:Number,borderRadius:[String,Number],fillBorderRadius:[String,Number],offsetDegree:Number}),F=T({name:"Progress",props:Re,setup(e){const o=D(()=>e.indicatorPlacement||e.indicatorPosition),s=D(()=>{if(e.gapDegree||e.gapDegree===0)return e.gapDegree;if(e.type==="dashboard")return 75}),{mergedClsPrefixRef:h,inlineThemeDisabled:f}=de(e),l=oe("Progress","-progress",De,ge,e,h),a=D(()=>{const{status:c}=e,{common:{cubicBezierEaseInOut:p},self:{fontSize:w,fontSizeCircle:x,railColor:g,railHeight:y,iconSizeCircle:i,iconSizeLine:n,textColorCircle:$,textColorLineInner:C,textColorLineOuter:S,lineBgProcessing:_,fontWeightCircle:R,[V("iconColor",c)]:O,[V("fillColor",c)]:I}}=l.value;return{"--n-bezier":p,"--n-fill-color":I,"--n-font-size":w,"--n-font-size-circle":x,"--n-font-weight-circle":R,"--n-icon-color":O,"--n-icon-size-circle":i,"--n-icon-size-line":n,"--n-line-bg-processing":_,"--n-rail-color":g,"--n-rail-height":y,"--n-text-color-circle":$,"--n-text-color-line-inner":C,"--n-text-color-line-outer":S}}),r=f?ue("progress",D(()=>e.status[0]),a,e):void 0;return{mergedClsPrefix:h,mergedIndicatorPlacement:o,gapDeg:s,cssVars:f?void 0:a,themeClass:r==null?void 0:r.themeClass,onRender:r==null?void 0:r.onRender}},render(){const{type:e,cssVars:o,indicatorTextColor:s,showIndicator:h,status:f,railColor:l,railStyle:a,color:r,percentage:c,viewBoxWidth:p,strokeWidth:w,mergedIndicatorPlacement:x,unit:g,borderRadius:y,fillBorderRadius:i,height:n,processing:$,circleGap:C,mergedClsPrefix:S,gapDeg:_,gapOffsetDegree:R,themeClass:O,$slots:I,onRender:m}=this;return m==null||m(),t("div",{class:[O,`${S}-progress`,`${S}-progress--${e}`,`${S}-progress--${f}`],style:o,"aria-valuemax":100,"aria-valuemin":0,"aria-valuenow":c,role:e==="circle"||e==="line"||e==="dashboard"?"progressbar":"none"},e==="circle"||e==="dashboard"?t(_e,{clsPrefix:S,status:f,showIndicator:h,indicatorTextColor:s,railColor:l,fillColor:r,railStyle:a,offsetDegree:this.offsetDegree,percentage:c,viewBoxWidth:p,strokeWidth:w,gapDegree:_===void 0?e==="dashboard"?75:0:_,gapOffsetDegree:R,unit:g},I):e==="line"?t(Be,{clsPrefix:S,status:f,showIndicator:h,indicatorTextColor:s,railColor:l,fillColor:r,railStyle:a,percentage:c,processing:$,indicatorPlacement:x,unit:g,fillBorderRadius:i,railBorderRadius:y,height:n},I):e==="multiple-circle"?t(ze,{clsPrefix:S,strokeWidth:w,railColor:l,fillColor:r,railStyle:a,viewBoxWidth:p,percentage:c,showIndicator:h,circleGap:C},I):null)}}),Ie={class:"quota-bar"},je={class:"quota-header"},We={class:"quota-label"},Te={class:"quota-track"},qe=T({__name:"QuotaBar",setup(e){const{quota:o,fetchQuota:s}=se(),h=D(()=>[{label:"并发",used:o.activeTasks,total:o.maxConcurrency,unlimited:!1},{label:"今日",used:o.dailyUsed,total:o.dailyQuota||null,unlimited:!o.dailyQuota},{label:"总量",used:o.totalUsed,total:o.totalQuota||null,unlimited:!o.totalQuota}]);function f(r){return r.unlimited||!r.total?0:Math.min(r.used/r.total*100,100)}function l(r){return r.unlimited||!r.total?!1:r.used/r.total>.8}function a(r){return r.unlimited?`${r.used} / 无限制`:`${r.used} / ${r.total}`}return pe(()=>{s().catch(()=>{})}),(r,c)=>(j(),A("div",Ie,[(j(!0),A(ae,null,ne(h.value,(p,w)=>(j(),A("div",{key:w,class:"quota-item"},[u("div",je,[u("span",We,B(p.label),1),u("span",{class:H(["quota-value",{warning:l(p)}])},B(a(p)),3)]),u("div",Te,[u("div",{class:H(["quota-fill",{warning:l(p)}]),style:fe({width:p.unlimited?"0%":f(p)+"%"})},null,6)])]))),128))]))}}),it=he(qe,[["__scopeId","data-v-2c684da6"]]),Oe={class:"mb-6"},Ae={class:"flex items-center gap-3"},Ue={class:"w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg"},Ee={class:"text-base font-medium"},Le={class:"mb-6"},Me={class:"space-y-4"},Ge={class:"flex justify-between text-xs mb-1"},Qe={class:"flex justify-between text-xs mb-1"},Fe={class:"flex justify-between text-xs mb-1"},Xe={class:"space-y-3"},Ve={class:"text-xs opacity-50"},He={key:1,class:"text-center text-sm opacity-50 py-4"},ot=T({__name:"UserCenter",props:{show:{type:Boolean}},emits:["update:show"],setup(e,{emit:o}){const s=e,h=o,f=z(s.show);M(()=>s.show,m=>f.value=m),M(f,m=>h("update:show",m));const{username:l,role:a,isAdmin:r,quota:c,fetchQuota:p,removeToken:w,headers:x}=se();M(()=>s.show,async m=>{if(m)try{await p()}catch{}});const g=z(""),y=z(""),i=z(""),n=z(!1),$=le();async function C(){if(!g.value||!y.value){$.warning("请填写完整");return}if(y.value!==i.value){$.warning("两次密码不一致");return}n.value=!0;try{const m=await fetch("/api/runway/auth/change-password",{method:"POST",headers:{...x(),"Content-Type":"application/json"},body:JSON.stringify({oldPassword:g.value,newPassword:y.value})});if(!m.ok){const v=await m.json().catch(()=>({}));throw new Error(v.message||"修改失败")}$.success("密码已修改"),g.value="",y.value="",i.value=""}catch(m){$.error(m.message??"修改密码失败")}finally{n.value=!1}}const S=z([]),_=z(!1);async function R(){_.value=!0;try{const m=await fetch("/api/runway/auth/devices",{headers:x()});if(!m.ok)throw new Error("获取设备列表失败");const v=await m.json();S.value=Array.isArray(v)?v:v.devices??[]}catch(m){$.error(m.message??"获取设备列表失败")}finally{_.value=!1}}function O(){w(),window.location.reload()}function I(m,v){return v?Math.round(m/v*100):0}return(m,v)=>(j(),G(d(Ce),{show:f.value,"onUpdate:show":v[3]||(v[3]=N=>f.value=N),width:360,placement:"right"},{default:P(()=>[k(d($e),{title:"用户中心",closable:""},{footer:P(()=>[k(d(X),{type:"error",block:"",onClick:O},{default:P(()=>[...v[9]||(v[9]=[Q(" 退出登录 ",-1)])]),_:1})]),default:P(()=>[u("div",Oe,[u("div",Ae,[u("div",Ue,B((d(l)??"U").charAt(0).toUpperCase()),1),u("div",null,[u("div",Ee,B(d(l)),1),k(d(ve),{type:d(r)?m.warning:m.info,size:"small",round:""},{default:P(()=>[Q(B(d(r)?"管理员":"用户"),1)]),_:1},8,["type"])])])]),u("div",Le,[v[7]||(v[7]=u("div",{class:"text-sm font-medium mb-3 opacity-70"},"配额概览",-1)),u("div",Me,[u("div",null,[u("div",Ge,[v[4]||(v[4]=u("span",null,"今日用量",-1)),u("span",null,B(d(c).dailyUsed)+" / "+B(d(c).dailyQuota),1)]),k(d(F),{type:"line",percentage:I(d(c).dailyUsed,d(c).dailyQuota),"show-indicator":!1,height:8,"border-radius":4,status:"info"},null,8,["percentage"])]),u("div",null,[u("div",Qe,[v[5]||(v[5]=u("span",null,"总用量",-1)),u("span",null,B(d(c).totalUsed)+" / "+B(d(c).totalQuota),1)]),k(d(F),{type:"line",percentage:I(d(c).totalUsed,d(c).totalQuota),"show-indicator":!1,height:8,"border-radius":4,status:"success"},null,8,["percentage"])]),u("div",null,[u("div",Fe,[v[6]||(v[6]=u("span",null,"活跃任务",-1)),u("span",null,B(d(c).activeTasks)+" / "+B(d(c).maxConcurrency),1)]),k(d(F),{type:"line",percentage:I(d(c).activeTasks,d(c).maxConcurrency),"show-indicator":!1,height:8,"border-radius":4,status:"warning"},null,8,["percentage"])])])]),k(d(ye),null,{default:P(()=>[k(d(K),{title:"修改密码",name:"password"},{default:P(()=>[u("div",Xe,[k(d(U),{value:g.value,"onUpdate:value":v[0]||(v[0]=N=>g.value=N),type:"password","show-password-on":"click",placeholder:"旧密码"},null,8,["value"]),k(d(U),{value:y.value,"onUpdate:value":v[1]||(v[1]=N=>y.value=N),type:"password","show-password-on":"click",placeholder:"新密码"},null,8,["value"]),k(d(U),{value:i.value,"onUpdate:value":v[2]||(v[2]=N=>i.value=N),type:"password","show-password-on":"click",placeholder:"确认新密码"},null,8,["value"]),k(d(X),{type:"primary",block:"",loading:n.value,onClick:C},{default:P(()=>[...v[8]||(v[8]=[Q(" 确认修改 ",-1)])]),_:1},8,["loading"])])]),_:1}),k(d(K),{title:"设备管理",name:"devices",onAfterEnter:R},{default:P(()=>[k(d(me),{show:_.value},{default:P(()=>[S.value.length?(j(),G(d(be),{key:0,bordered:"",size:"small"},{default:P(()=>[(j(!0),A(ae,null,ne(S.value,N=>(j(),G(d(we),{key:N.id},{default:P(()=>[k(d(xe),{title:N.ua||m.未知设备,description:`IP: ${N.ip}`},{"header-extra":P(()=>[u("span",Ve,B(N.lastActive),1)]),_:2},1032,["title","description"])]),_:2},1024))),128))]),_:1})):(j(),A("div",He," 暂无设备信息 "))]),_:1},8,["show"])]),_:1})]),_:1})]),_:1})]),_:1},8,["show"]))}});function Ke(){const e=[];e.push(`${screen.width}x${screen.height}x${screen.colorDepth}`),e.push(Intl.DateTimeFormat().resolvedOptions().timeZone),e.push(navigator.language),e.push(navigator.platform||"unknown"),e.push(String(navigator.hardwareConcurrency||0));try{const s=document.createElement("canvas"),h=s.getContext("webgl")||s.getContext("experimental-webgl");if(h){const f=h.getExtension("WEBGL_debug_renderer_info");f&&e.push(h.getParameter(f.UNMASKED_RENDERER_WEBGL)||"")}}catch{}try{const s=document.createElement("canvas");s.width=200,s.height=50;const h=s.getContext("2d");h&&(h.textBaseline="top",h.font="14px Arial",h.fillText("fingerprint:"+navigator.userAgent.slice(0,20),2,2),e.push(s.toDataURL().slice(-50)))}catch{}e.push(String("ontouchstart"in window));const o=e.join("|");return Ye(o)}function Ye(e){let o=2166136261;for(let s=0;s<e.length;s++)o^=e.charCodeAt(s),o=Math.imul(o,16777619);return(o>>>0).toString(16).padStart(8,"0")}function Je(){const e=navigator.userAgent;let o="Unknown",s="Unknown";return e.includes("Edg/")?o="Edge":e.includes("Chrome/")?o="Chrome":e.includes("Firefox/")?o="Firefox":e.includes("Safari/")&&!e.includes("Chrome")&&(o="Safari"),e.includes("Windows")?s="Windows":e.includes("Mac OS")?s="macOS":e.includes("Linux")?s="Linux":e.includes("Android")?s="Android":(e.includes("iPhone")||e.includes("iPad"))&&(s="iOS"),{browser:o,os:s}}const L=z(""),J=z(null);function Ze(){if(!L.value){L.value=Ke();const{browser:e,os:o}=Je();J.value={fingerprint:L.value,deviceName:`${e} on ${o}`,browser:e,os:o}}return{fingerprint:L,deviceInfo:J}}const et={class:"rounded-2xl bg-white/95 p-1 dark:bg-slate-900/95"},tt={class:"space-y-3 px-1 pb-1"},st=T({__name:"RunwayLoginModal",props:{show:{type:Boolean}},emits:["update:show","loggedIn"],setup(e,{emit:o}){const s=e,h=o,{setToken:f}=Se(),{deviceInfo:l}=Ze(),a=le(),r=z(""),c=z(""),p=z(!1),w=D(()=>r.value.trim()!==""&&c.value.trim()!==""),x=async()=>{var y,i,n;if(!(!w.value||p.value)){p.value=!0;try{const $=await fetch("/api/runway/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:r.value.trim(),password:c.value,device:l.value})}),C=await $.json();if(!$.ok)throw new Error(C.error||"登录失败，请检查账号或密码");f(C.token,(y=C.user)==null?void 0:y.username,(i=C.user)==null?void 0:i.role),C.isNewDevice&&a.warning("新设备登录，已记录",{duration:5e3}),C.isSuspicious&&a.warning("检测到异常登录，管理员已收到通知",{duration:6e3}),a.success(`欢迎回来，${((n=C.user)==null?void 0:n.username)??"用户"}`),c.value="",h("update:show",!1),h("loggedIn")}catch($){a.error($.message||"登录失败")}finally{p.value=!1}}},g=y=>{y.key==="Enter"&&x()};return M(()=>s.show,y=>{y||(c.value="",p.value=!1)}),(y,i)=>(j(),G(d(ke),{show:s.show,preset:"card",closable:!1,"mask-closable":!1,style:{width:"min(92vw, 420px)"}},{default:P(()=>[u("div",et,[i[5]||(i[5]=u("div",{class:"mb-5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-4 text-white shadow-lg shadow-cyan-500/20 dark:from-cyan-600 dark:to-blue-700"},[u("p",{class:"text-lg font-semibold"},"视频工作台"),u("p",{class:"mt-1 text-xs text-cyan-50/90"},"请登录后继续创建视频任务")],-1)),u("div",tt,[u("div",null,[i[2]||(i[2]=u("p",{class:"mb-1 text-xs text-slate-500 dark:text-slate-400"},"用户名",-1)),k(d(U),{value:r.value,"onUpdate:value":i[0]||(i[0]=n=>r.value=n),placeholder:"请输入用户名",disabled:p.value,onKeydown:g},null,8,["value","disabled"])]),u("div",null,[i[3]||(i[3]=u("p",{class:"mb-1 text-xs text-slate-500 dark:text-slate-400"},"密码",-1)),k(d(U),{value:c.value,"onUpdate:value":i[1]||(i[1]=n=>c.value=n),type:"password",placeholder:"请输入密码","show-password-on":"click",disabled:p.value,onKeydown:g},null,8,["value","disabled"])]),k(d(X),{type:"primary",block:"",size:"large",loading:p.value,disabled:!w.value,onClick:x},{default:P(()=>[...i[4]||(i[4]=[Q(" 登录并进入 ",-1)])]),_:1},8,["loading","disabled"])])])]),_:1},8,["show"]))}});export{F as N,it as Q,st as _,ot as a};
