export const RENDERER = "!function(){\"use strict\";var e=JSON.parse('{\"FP\":{\"h0\":\"adRenderFailed\",\"gV\":\"adRenderSucceeded\"},\"q_\":{\"Ex\":\"noAd\"},\"X3\":{\"Ks\":\"Prebid Event\"}}');const d=e.X3.Ks,n=e.FP.gV,s=e.FP.h0,i=e.q_.Ex;window.render=function({ad:e,adUrl:r,width:a,height:t},{sendMessage:o,mkFrame:c},h=document){if(e||r){const s={width:a,height:t};r&&!e?s.src=r:s.srcdoc=e,h.body.appendChild(c(h,s)),o(d,{event:n})}else o(d,{event:s,info:{reason:i,message:\"Missing ad markup or URL\"}})}}();";