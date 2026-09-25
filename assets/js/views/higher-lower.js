import {rpc} from "../api.js";
import {h,fmt,toast} from "../ui.js";
import {sfx} from "../sound.js";import {meme,sessionMeme} from "../memes.js";

const rv=v=>v===14?"A":v===13?"K":v===12?"Q":v===11?"J":String(v);
const sv=s=>({S:"♠",H:"♥",D:"♦",C:"♣"}[s]||s);
const title=v=>v===14?"Председатель":v===13?"Финдиректор":v===12?"Юротдел":v===11?"Риск-менеджер":"Карточный департамент";

function card(c,big=false){
  return h("div",{class:"luz-card hl-live-card "+(["H","D"].includes(c.suit)?"red ":"")+(big?"big":"")},
    h("div",{class:"hl-corner"},h("b",{},rv(c.rank)),h("i",{},sv(c.suit))),
    h("div",{class:"hl-card-center"},h("span",{},sv(c.suit)),h("div",{class:"card-face"},c.rank>10?"ЛК":"•")),
    h("small",{},title(c.rank)));
}
function back(){return h("div",{class:"hl-card-back"},h("div",{class:"hl-back-frame"},h("b",{},"ЛК"),h("span",{},"LUZBET"),h("small",{},"КАРТОЧНЫЙ ДЕПАРТАМЕНТ")))}

export async function mount(root,{app}){
  let round=null,busy=false;
  const bet=h("input",{class:"input hl-bet-input",type:"number",min:1,max:5000,value:100});
  const stage=h("div",{class:"hl-live-stage"});
  const status=h("div",{class:"hl-live-status"},"Колода опечатана. Карточный департамент ожидает распоряжений.");
  const controls=h("div",{class:"hl-control-panel"});
  const caseNo=h("span",{class:"hl-case"},"ДЕЛО НЕ ОТКРЫТО");

  const lock=v=>{busy=v;controls.classList.toggle("is-busy",v)};

  function draw(){
    controls.replaceChildren();stage.replaceChildren();
    if(!round){
      stage.append(h("div",{class:"hl-table-mark"},"LUZBET • CARD DIVISION"),back());
      controls.append(
        h("div",{class:"hl-bet-box"},h("div",{},h("span",{class:"eyebrow"},"Сумма служебной ошибки"),h("strong",{},bet.value+" ЛК")),bet),
        h("button",{class:"btn primary lg block hl-start",onclick:start},"ОТКРЫТЬ ДЕЛО"),
        h("small",{class:"hl-footnote"},"Нажимая кнопку, вы подтверждаете, что математика была вам объяснена, но проигнорирована.")
      );return;
    }
    const s=round.state,o=s.options||{},total=+o.total||0,hi=+o.higher||0,lo=+o.lower||0,m=+s.multiplier||1;
    caseNo.textContent="ДЕЛО "+String(round.id||"").slice(0,8).toUpperCase();
    stage.append(h("div",{class:"hl-table-mark"},"LUZBET • CARD DIVISION"),h("div",{class:"hl-card-shadow"}),card(s.current,true));
    const choices=h("div",{class:"hl-action-grid"});
    for(const [g,label,n,arrow] of [["lower","МЕНЬШЕ",lo,"↓"],["higher","БОЛЬШЕ",hi,"↑"]]){
      const p=total?n/total:0;
      const b=h("button",{class:"hl-choice "+g,disabled:!n||busy},
        h("span",{class:"hl-arrow"},arrow),h("b",{},label),
        h("strong",{},n?Math.round(p*100)+"%":"—"),
        h("small",{},n?"коэф. шага ×"+(1/p).toFixed(2):"комитет запретил"));
      b.onclick=()=>guess(g);choices.append(b);
    }
    controls.append(
      h("div",{class:"hl-decision-label"},h("span",{class:"eyebrow"},"Решение комиссии"),h("small",{},"Что будет со следующей картой?")),
      choices,
      h("div",{class:"hl-live-meta"},
        h("div",{},h("small",{},"ТЕКУЩИЙ МНОЖИТЕЛЬ"),h("strong",{},"×"+m.toFixed(2))),
        h("div",{},h("small",{},"К ВЫПЛАТЕ"),h("strong",{},fmt(Math.floor(round.bet*m))+" ЛК"))));
    if(m>1)controls.append(h("button",{class:"btn primary block hl-cash",onclick:cash,disabled:busy},"ЗАФИКСИРОВАТЬ ПОДОЗРИТЕЛЬНО РАЗУМНОЕ РЕШЕНИЕ"));
    if(s.history?.length>1)controls.append(h("div",{class:"hl-history-wrap"},h("span",{class:"eyebrow"},"Материалы дела"),h("div",{class:"hl-history"},s.history.slice(-9).map(x=>card(x)))));
  }
  async function start(){
    if(busy)return;const n=Math.floor(+bet.value);if(!n||n<1)return toast("Финансовый отдел не обнаружил ставку.","error");
    try{lock(true);status.textContent="Секретарь тасует документы и колоду…";const r=await rpc("rpc_higher_lower_start",{p_bet:n,p_idempotency_key:crypto.randomUUID()});round=r.round;app.setBalance(round.balance);status.textContent=meme("hl.start");draw()}catch(e){toast(e.message,"error");status.textContent="Юротдел временно остановил производство."}finally{lock(false);draw()}
  }
  async function guess(g){
    if(busy||!round)return;
    try{lock(true);status.textContent="Комитет случайных чисел проводит закрытое заседание…";const r=await rpc("rpc_higher_lower_guess",{p_round_id:round.id,p_guess:g,p_idempotency_key:crypto.randomUUID()});round=r.round;app.setBalance(round.balance);draw();
      if(round.status==="finished"){status.textContent="Прогноз отклонён. Карточный департамент выражает формальное сочувствие.";sfx.error();toast("Карточный департамент отклоняет прогноз.","error");setTimeout(()=>{round=null;caseNo.textContent="ДЕЛО ЗАКРЫТО";draw()},1900)}
      else{status.textContent="Комиссия вынуждена признать: на этот раз вы были правы.";sfx.cash()}
    }catch(e){toast(e.message,"error");status.textContent="Заседание сорвано по техническим причинам."}finally{lock(false);if(round?.status!=="finished")draw()}
  }
  async function cash(){
    if(busy||!round)return;
    try{lock(true);const r=await rpc("rpc_higher_lower_cashout",{p_round_id:round.id,p_idempotency_key:crypto.randomUUID()});app.setBalance(r.round.balance);await app.refreshMe();sfx.cash();toast("Юротдел подтвердил: прибыль действительно существовала.","ok");round=null;caseNo.textContent="ДЕЛО ЗАКРЫТО С ПРИБЫЛЬЮ";status.textContent="Производство прекращено в связи с внезапным проявлением здравого смысла."}catch(e){toast(e.message,"error")}finally{lock(false);draw()}
  }

  root.append(h("div",{class:"container hl-live"},
    h("section",{class:"hl-live-head"},
      h("div",{class:"hl-head-row"},h("span",{class:"eyebrow"},"ЛУЗБЕТ • КАРТОЧНЫЙ ДЕПАРТАМЕНТ"),caseNo),
      h("h1",{},"Больше ",h("em",{},"/")," Меньше"),
      h("p",{class:"muted"},"Одна карта. Два решения. 52 уникальных документа в деле и ни одного права на одинаковый номинал подряд.")),
    h("section",{class:"hl-live-layout"},
      h("div",{class:"hl-table card gilded"},stage,status),
      h("aside",{class:"card hl-console"},h("div",{class:"hl-console-top"},h("span",{class:"eyebrow"},"ПАНЕЛЬ ПРИНЯТИЯ РЕШЕНИЙ"),h("span",{class:"badge gold"},"RTP 97%")),controls)),
    h("div",{class:"hl-regulation"},h("b",{},"§ 13.4 ВНУТРЕННЕГО РЕГЛАМЕНТА"),h("span",{},"Если на столе 8 — следующей не может стать ни одна другая восьмёрка."),h("small",{},"Даже случайность в ЛузБете сначала проходит комплаенс.")));
  bet.oninput=()=>{if(!round)draw()};draw();
}