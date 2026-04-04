import{e as V,f as a,bm as v,bl as N,g as de,ca as We,cb as qe,cc as Ze,d as Ge,h as Je,k as ve,i as Qe,l as w,r as k,j as et,Z as ce,bk as tt,p as ue,q as ot,s as Z,t as f,V as nt,v as at,bt as rt,x as it,T as lt,cd as st,B as dt,F as P,ce as j,cf as U,an as q}from"./index-c4e19b20.js";const ct=V([a("slider",`
 display: block;
 padding: calc((var(--n-handle-size) - var(--n-rail-height)) / 2) 0;
 position: relative;
 z-index: 0;
 width: 100%;
 cursor: pointer;
 user-select: none;
 -webkit-user-select: none;
 `,[v("reverse",[a("slider-handles",[a("slider-handle-wrapper",`
 transform: translate(50%, -50%);
 `)]),a("slider-dots",[a("slider-dot",`
 transform: translateX(50%, -50%);
 `)]),v("vertical",[a("slider-handles",[a("slider-handle-wrapper",`
 transform: translate(-50%, -50%);
 `)]),a("slider-marks",[a("slider-mark",`
 transform: translateY(calc(-50% + var(--n-dot-height) / 2));
 `)]),a("slider-dots",[a("slider-dot",`
 transform: translateX(-50%) translateY(0);
 `)])])]),v("vertical",`
 box-sizing: content-box;
 padding: 0 calc((var(--n-handle-size) - var(--n-rail-height)) / 2);
 width: var(--n-rail-width-vertical);
 height: 100%;
 `,[a("slider-handles",`
 top: calc(var(--n-handle-size) / 2);
 right: 0;
 bottom: calc(var(--n-handle-size) / 2);
 left: 0;
 `,[a("slider-handle-wrapper",`
 top: unset;
 left: 50%;
 transform: translate(-50%, 50%);
 `)]),a("slider-rail",`
 height: 100%;
 `,[N("fill",`
 top: unset;
 right: 0;
 bottom: unset;
 left: 0;
 `)]),v("with-mark",`
 width: var(--n-rail-width-vertical);
 margin: 0 32px 0 8px;
 `),a("slider-marks",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 22px;
 font-size: var(--n-mark-font-size);
 `,[a("slider-mark",`
 transform: translateY(50%);
 white-space: nowrap;
 `)]),a("slider-dots",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 50%;
 `,[a("slider-dot",`
 transform: translateX(-50%) translateY(50%);
 `)])]),v("disabled",`
 cursor: not-allowed;
 opacity: var(--n-opacity-disabled);
 `,[a("slider-handle",`
 cursor: not-allowed;
 `)]),v("with-mark",`
 width: 100%;
 margin: 8px 0 32px 0;
 `),V("&:hover",[a("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[N("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),a("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),v("active",[a("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[N("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),a("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),a("slider-marks",`
 position: absolute;
 top: 18px;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[a("slider-mark",`
 position: absolute;
 transform: translateX(-50%);
 white-space: nowrap;
 `)]),a("slider-rail",`
 width: 100%;
 position: relative;
 height: var(--n-rail-height);
 background-color: var(--n-rail-color);
 transition: background-color .3s var(--n-bezier);
 border-radius: calc(var(--n-rail-height) / 2);
 `,[N("fill",`
 position: absolute;
 top: 0;
 bottom: 0;
 border-radius: calc(var(--n-rail-height) / 2);
 transition: background-color .3s var(--n-bezier);
 background-color: var(--n-fill-color);
 `)]),a("slider-handles",`
 position: absolute;
 top: 0;
 right: calc(var(--n-handle-size) / 2);
 bottom: 0;
 left: calc(var(--n-handle-size) / 2);
 `,[a("slider-handle-wrapper",`
 outline: none;
 position: absolute;
 top: 50%;
 transform: translate(-50%, -50%);
 cursor: pointer;
 display: flex;
 `,[a("slider-handle",`
 height: var(--n-handle-size);
 width: var(--n-handle-size);
 border-radius: 50%;
 overflow: hidden;
 transition: box-shadow .2s var(--n-bezier), background-color .3s var(--n-bezier);
 background-color: var(--n-handle-color);
 box-shadow: var(--n-handle-box-shadow);
 `,[V("&:hover",`
 box-shadow: var(--n-handle-box-shadow-hover);
 `)]),V("&:focus",[a("slider-handle",`
 box-shadow: var(--n-handle-box-shadow-focus);
 `,[V("&:hover",`
 box-shadow: var(--n-handle-box-shadow-active);
 `)])])])]),a("slider-dots",`
 position: absolute;
 top: 50%;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[v("transition-disabled",[a("slider-dot","transition: none;")]),a("slider-dot",`
 transition:
 border-color .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 position: absolute;
 transform: translate(-50%, -50%);
 height: var(--n-dot-height);
 width: var(--n-dot-width);
 border-radius: var(--n-dot-border-radius);
 overflow: hidden;
 box-sizing: border-box;
 border: var(--n-dot-border);
 background-color: var(--n-dot-color);
 `,[v("active","border: var(--n-dot-border-active);")])])]),a("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[de()]),a("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[v("top",`
 margin-bottom: 12px;
 `),v("right",`
 margin-left: 12px;
 `),v("bottom",`
 margin-top: 12px;
 `),v("left",`
 margin-right: 12px;
 `),de()]),We(a("slider",[a("slider-dot","background-color: var(--n-dot-color-modal);")])),qe(a("slider",[a("slider-dot","background-color: var(--n-dot-color-popover);")]))]);function he(n){return window.TouchEvent&&n instanceof window.TouchEvent}function fe(){const n=new Map,l=T=>p=>{n.set(T,p)};return Ze(()=>{n.clear()}),[n,l]}const ut=0,ht=Object.assign(Object.assign({},ve.props),{to:Z.propTo,defaultValue:{type:[Number,Array],default:0},marks:Object,disabled:{type:Boolean,default:void 0},formatTooltip:Function,keyboard:{type:Boolean,default:!0},min:{type:Number,default:0},max:{type:Number,default:100},step:{type:[Number,String],default:1},range:Boolean,value:[Number,Array],placement:String,showTooltip:{type:Boolean,default:void 0},tooltip:{type:Boolean,default:!0},vertical:Boolean,reverse:Boolean,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onDragstart:[Function],onDragend:[Function]}),vt=Ge({name:"Slider",props:ht,slots:Object,setup(n){const{mergedClsPrefixRef:l,namespaceRef:T,inlineThemeDisabled:p}=Je(n),s=ve("Slider","-slider",ct,st,n,l),u=k(null),[D,C]=fe(),[me,be]=fe(),ge=k(new Set),G=Qe(n),{mergedDisabledRef:M}=G,J=w(()=>{const{step:e}=n;if(Number(e)<=0||e==="mark")return 0;const t=e.toString();let o=0;return t.includes(".")&&(o=t.length-t.indexOf(".")-1),o}),O=k(n.defaultValue),we=dt(n,"value"),_=et(we,O),m=w(()=>{const{value:e}=_;return(n.range?e:[e]).map(re)}),Q=w(()=>m.value.length>2),pe=w(()=>n.placement===void 0?n.vertical?"right":"top":n.placement),ee=w(()=>{const{marks:e}=n;return e?Object.keys(e).map(Number.parseFloat):null}),b=k(-1),te=k(-1),y=k(-1),R=k(!1),$=k(!1),L=w(()=>{const{vertical:e,reverse:t}=n;return e?t?"top":"bottom":t?"right":"left"}),xe=w(()=>{if(Q.value)return;const e=m.value,t=B(n.range?Math.min(...e):n.min),o=B(n.range?Math.max(...e):e[0]),{value:r}=L;return n.vertical?{[r]:`${t}%`,height:`${o-t}%`}:{[r]:`${t}%`,width:`${o-t}%`}}),ke=w(()=>{const e=[],{marks:t}=n;if(t){const o=m.value.slice();o.sort((h,c)=>h-c);const{value:r}=L,{value:i}=Q,{range:d}=n,g=i?()=>!1:h=>d?h>=o[0]&&h<=o[o.length-1]:h<=o[0];for(const h of Object.keys(t)){const c=Number(h);e.push({active:g(c),key:c,label:t[h],style:{[r]:`${B(c)}%`}})}}return e});function ye(e,t){const o=B(e),{value:r}=L;return{[r]:`${o}%`,zIndex:t===b.value?1:0}}function oe(e){return n.showTooltip||y.value===e||b.value===e&&R.value}function Re(e){return R.value?!(b.value===e&&te.value===e):!0}function ze(e){var t;~e&&(b.value=e,(t=D.get(e))===null||t===void 0||t.focus())}function Se(){me.forEach((e,t)=>{oe(t)&&e.syncPosition()})}function ne(e){const{"onUpdate:value":t,onUpdateValue:o}=n,{nTriggerFormInput:r,nTriggerFormChange:i}=G;o&&P(o,e),t&&P(t,e),O.value=e,r(),i()}function ae(e){const{range:t}=n;if(t){if(Array.isArray(e)){const{value:o}=m;e.join()!==o.join()&&ne(e)}}else Array.isArray(e)||m.value[0]!==e&&ne(e)}function K(e,t){if(n.range){const o=m.value.slice();o.splice(t,1,e),ae(o)}else ae(e)}function X(e,t,o){const r=o!==void 0;o||(o=e-t>0?1:-1);const i=ee.value||[],{step:d}=n;if(d==="mark"){const c=I(e,i.concat(t),r?o:void 0);return c?c.value:t}if(d<=0)return t;const{value:g}=J;let h;if(r){const c=Number((t/d).toFixed(g)),x=Math.floor(c),Y=c>x?x:x-1,W=c<x?x:x+1;h=I(t,[Number((Y*d).toFixed(g)),Number((W*d).toFixed(g)),...i],o)}else{const c=Ce(e);h=I(e,[...i,c])}return h?re(h.value):t}function re(e){return Math.min(n.max,Math.max(n.min,e))}function B(e){const{max:t,min:o}=n;return(e-o)/(t-o)*100}function Te(e){const{max:t,min:o}=n;return o+(t-o)*e}function Ce(e){const{step:t,min:o}=n;if(Number(t)<=0||t==="mark")return e;const r=Math.round((e-o)/t)*t+o;return Number(r.toFixed(J.value))}function I(e,t=ee.value,o){if(!(t!=null&&t.length))return null;let r=null,i=-1;for(;++i<t.length;){const d=t[i]-e,g=Math.abs(d);(o===void 0||d*o>0)&&(r===null||g<r.distance)&&(r={index:i,distance:g,value:t[i]})}return r}function ie(e){const t=u.value;if(!t)return;const o=he(e)?e.touches[0]:e,r=t.getBoundingClientRect();let i;return n.vertical?i=(r.bottom-o.clientY)/r.height:i=(o.clientX-r.left)/r.width,n.reverse&&(i=1-i),Te(i)}function Ve(e){if(M.value||!n.keyboard)return;const{vertical:t,reverse:o}=n;switch(e.key){case"ArrowUp":e.preventDefault(),F(t&&o?-1:1);break;case"ArrowRight":e.preventDefault(),F(!t&&o?-1:1);break;case"ArrowDown":e.preventDefault(),F(t&&o?1:-1);break;case"ArrowLeft":e.preventDefault(),F(!t&&o?1:-1);break}}function F(e){const t=b.value;if(t===-1)return;const{step:o}=n,r=m.value[t],i=Number(o)<=0||o==="mark"?r:r+o*e;K(X(i,r,e>0?1:-1),t)}function De(e){var t,o;if(M.value||!he(e)&&e.button!==ut)return;const r=ie(e);if(r===void 0)return;const i=m.value.slice(),d=n.range?(o=(t=I(r,i))===null||t===void 0?void 0:t.index)!==null&&o!==void 0?o:-1:0;d!==-1&&(e.preventDefault(),ze(d),Me(),K(X(r,m.value[d]),d))}function Me(){R.value||(R.value=!0,n.onDragstart&&P(n.onDragstart),j("touchend",document,E),j("mouseup",document,E),j("touchmove",document,A),j("mousemove",document,A))}function H(){R.value&&(R.value=!1,n.onDragend&&P(n.onDragend),U("touchend",document,E),U("mouseup",document,E),U("touchmove",document,A),U("mousemove",document,A))}function A(e){const{value:t}=b;if(!R.value||t===-1){H();return}const o=ie(e);o!==void 0&&K(X(o,m.value[t]),t)}function E(){H()}function $e(e){b.value=e,M.value||(y.value=e)}function Be(e){b.value===e&&(b.value=-1,H()),y.value===e&&(y.value=-1)}function Ie(e){y.value=e}function Fe(e){y.value===e&&(y.value=-1)}ce(b,(e,t)=>void q(()=>te.value=t)),ce(_,()=>{if(n.marks){if($.value)return;$.value=!0,q(()=>{$.value=!1})}q(Se)}),tt(()=>{H()});const le=w(()=>{const{self:{markFontSize:e,railColor:t,railColorHover:o,fillColor:r,fillColorHover:i,handleColor:d,opacityDisabled:g,dotColor:h,dotColorModal:c,handleBoxShadow:x,handleBoxShadowHover:Y,handleBoxShadowActive:W,handleBoxShadowFocus:He,dotBorder:Ae,dotBoxShadow:Ee,railHeight:Ne,railWidthVertical:Pe,handleSize:je,dotHeight:Ue,dotWidth:Oe,dotBorderRadius:_e,fontSize:Le,dotBorderActive:Ke,dotColorPopover:Xe},common:{cubicBezierEaseInOut:Ye}}=s.value;return{"--n-bezier":Ye,"--n-dot-border":Ae,"--n-dot-border-active":Ke,"--n-dot-border-radius":_e,"--n-dot-box-shadow":Ee,"--n-dot-color":h,"--n-dot-color-modal":c,"--n-dot-color-popover":Xe,"--n-dot-height":Ue,"--n-dot-width":Oe,"--n-fill-color":r,"--n-fill-color-hover":i,"--n-font-size":Le,"--n-handle-box-shadow":x,"--n-handle-box-shadow-active":W,"--n-handle-box-shadow-focus":He,"--n-handle-box-shadow-hover":Y,"--n-handle-color":d,"--n-handle-size":je,"--n-opacity-disabled":g,"--n-rail-color":t,"--n-rail-color-hover":o,"--n-rail-height":Ne,"--n-rail-width-vertical":Pe,"--n-mark-font-size":e}}),z=p?ue("slider",void 0,le,n):void 0,se=w(()=>{const{self:{fontSize:e,indicatorColor:t,indicatorBoxShadow:o,indicatorTextColor:r,indicatorBorderRadius:i}}=s.value;return{"--n-font-size":e,"--n-indicator-border-radius":i,"--n-indicator-box-shadow":o,"--n-indicator-color":t,"--n-indicator-text-color":r}}),S=p?ue("slider-indicator",void 0,se,n):void 0;return{mergedClsPrefix:l,namespace:T,uncontrolledValue:O,mergedValue:_,mergedDisabled:M,mergedPlacement:pe,isMounted:ot(),adjustedTo:Z(n),dotTransitionDisabled:$,markInfos:ke,isShowTooltip:oe,shouldKeepTooltipTransition:Re,handleRailRef:u,setHandleRefs:C,setFollowerRefs:be,fillStyle:xe,getHandleStyle:ye,activeIndex:b,arrifiedValues:m,followerEnabledIndexSet:ge,handleRailMouseDown:De,handleHandleFocus:$e,handleHandleBlur:Be,handleHandleMouseEnter:Ie,handleHandleMouseLeave:Fe,handleRailKeyDown:Ve,indicatorCssVars:p?void 0:se,indicatorThemeClass:S==null?void 0:S.themeClass,indicatorOnRender:S==null?void 0:S.onRender,cssVars:p?void 0:le,themeClass:z==null?void 0:z.themeClass,onRender:z==null?void 0:z.onRender}},render(){var n;const{mergedClsPrefix:l,themeClass:T,formatTooltip:p}=this;return(n=this.onRender)===null||n===void 0||n.call(this),f("div",{class:[`${l}-slider`,T,{[`${l}-slider--disabled`]:this.mergedDisabled,[`${l}-slider--active`]:this.activeIndex!==-1,[`${l}-slider--with-mark`]:this.marks,[`${l}-slider--vertical`]:this.vertical,[`${l}-slider--reverse`]:this.reverse}],style:this.cssVars,onKeydown:this.handleRailKeyDown,onMousedown:this.handleRailMouseDown,onTouchstart:this.handleRailMouseDown},f("div",{class:`${l}-slider-rail`},f("div",{class:`${l}-slider-rail__fill`,style:this.fillStyle}),this.marks?f("div",{class:[`${l}-slider-dots`,this.dotTransitionDisabled&&`${l}-slider-dots--transition-disabled`]},this.markInfos.map(s=>f("div",{key:s.key,class:[`${l}-slider-dot`,{[`${l}-slider-dot--active`]:s.active}],style:s.style}))):null,f("div",{ref:"handleRailRef",class:`${l}-slider-handles`},this.arrifiedValues.map((s,u)=>{const D=this.isShowTooltip(u);return f(nt,null,{default:()=>[f(at,null,{default:()=>f("div",{ref:this.setHandleRefs(u),class:`${l}-slider-handle-wrapper`,tabindex:this.mergedDisabled?-1:0,role:"slider","aria-valuenow":s,"aria-valuemin":this.min,"aria-valuemax":this.max,"aria-orientation":this.vertical?"vertical":"horizontal","aria-disabled":this.disabled,style:this.getHandleStyle(s,u),onFocus:()=>{this.handleHandleFocus(u)},onBlur:()=>{this.handleHandleBlur(u)},onMouseenter:()=>{this.handleHandleMouseEnter(u)},onMouseleave:()=>{this.handleHandleMouseLeave(u)}},rt(this.$slots.thumb,()=>[f("div",{class:`${l}-slider-handle`})]))}),this.tooltip&&f(it,{ref:this.setFollowerRefs(u),show:D,to:this.adjustedTo,enabled:this.showTooltip&&!this.range||this.followerEnabledIndexSet.has(u),teleportDisabled:this.adjustedTo===Z.tdkey,placement:this.mergedPlacement,containerClass:this.namespace},{default:()=>f(lt,{name:"fade-in-scale-up-transition",appear:this.isMounted,css:this.shouldKeepTooltipTransition(u),onEnter:()=>{this.followerEnabledIndexSet.add(u)},onAfterLeave:()=>{this.followerEnabledIndexSet.delete(u)}},{default:()=>{var C;return D?((C=this.indicatorOnRender)===null||C===void 0||C.call(this),f("div",{class:[`${l}-slider-handle-indicator`,this.indicatorThemeClass,`${l}-slider-handle-indicator--${this.mergedPlacement}`],style:this.indicatorCssVars},typeof p=="function"?p(s):s)):null}})})]})})),this.marks?f("div",{class:`${l}-slider-marks`},this.markInfos.map(s=>f("div",{key:s.key,class:`${l}-slider-mark`,style:s.style},typeof s.label=="function"?s.label():s.label))):null))}});export{vt as N};
