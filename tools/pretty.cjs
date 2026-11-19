const fs = require('node:fs');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
const dir='dist/js/';
for(const file of fs.readdirSync(dir)){
 if(!file.endsWith('.js')||file==='wallet.js')continue;
 const src=fs.readFileSync(dir+file,'utf8'), tokens=[], comments=[];
 const opts={ecmaVersion:'latest',sourceType:'module'};
 const ast=acorn.parse(src,{...opts,onToken:tokens,onComment:comments});
 const before=new Set(),soft=new Set(),inc=new Set(),dec=new Set(),ops=new Set(),ranges=new Map(),openLong=new Set(),closeLong=new Set();
 function inspect(n,parent){
  if(!n||!n.type)return;
  if(n.type==='TemplateLiteral'){ranges.set(n.start,n.end);return}
  if(n.type==='ClassBody'||n.type==='BlockStatement'){
    if(n.body.length){inc.add(n.start);dec.add(n.end-1);before.add(n.end-1);for(const st of n.body)before.add(st.start)}
  }
  if(n.type==='Program')for(const st of n.body)before.add(st.start);
  if(n.type==='VariableDeclaration'&&n.declarations.length>1&&n.end-n.start>110&&!parent?.type.startsWith('For'))for(const d of n.declarations.slice(1))soft.add(d.start);
  if(n.type==='ObjectExpression'&&n.properties.length>1&&n.end-n.start>140){
   const props=n.properties;
   inc.add(n.start);dec.add(n.end-1);before.add(n.end-1);
   props.forEach(p=>before.add(p.start));
  }
  if(n.type==='ArrayExpression'&&n.elements.length>2&&n.end-n.start>180&&n.elements.every(e=>e&&['ArrayExpression','ObjectExpression','CallExpression'].includes(e.type))){
   inc.add(n.start);dec.add(n.end-1);before.add(n.end-1);
   n.elements.forEach(e=>before.add(e.start))
  }
  if(['BinaryExpression','LogicalExpression','AssignmentExpression','AssignmentPattern'].includes(n.type)){
   const b=n.left.end, e=n.right.start, op=n.operator||'=';
   const part=src.slice(b,e), idx=part.indexOf(op);if(idx>=0)ops.add(b+idx);
  }
  if(n.type==='ConditionalExpression'){
    const q=src.indexOf('?',n.test.end),c=src.indexOf(':',n.consequent.end);if(q<n.consequent.start)ops.add(q);if(c<n.alternate.start)ops.add(c);
  }
  for(const k of Object.keys(n)){const v=n[k];if(Array.isArray(v))v.forEach(c=>inspect(c,n));else if(v&&typeof v==='object')inspect(v,n)}
 }
 inspect(ast,null);
 const streams=[...tokens.filter(t=>t.end>t.start),...comments.map(c=>({...c,isComment:true}))].sort((a,b)=>a.start-b.start);
 let skipTo=-1,level=0,output='',line='',prev=null;
 const finish=()=>{if(line.trim()){output+=line.trimEnd()+'\n';line=''}};
 for(const token of streams){let {start,end}=token;if(start<skipTo)continue;if(ranges.has(start)){end=ranges.get(start);skipTo=end}
  const val=src.slice(start,end),prevVal=prev?.val;
  if(dec.has(start))level--;
  const sourceGap=prev?src.slice(prev.end,start):'';
  if(before.has(start)||soft.has(start)||token.isComment||(prev?.isComment)||src.slice(prev?.end??0,start).includes('\n\n'))finish();
  let space=false;
  if(line){
    if(sourceGap.trim()===''&&sourceGap.length)space=true;
    if(prevVal===','||prevVal===';'||prevVal===':'||val==='='||prevVal==='='||val==='=>'||prevVal==='=>'||ops.has(start)||ops.has(prev?.start))space=true;
    if(val==='{'&&prevVal!=='.'&&prevVal!=='[')space=true;
    if(val==='('&&['if','for','while','switch','catch','with'].includes(prevVal))space=true;
    if(prevVal==='}'&&['else','catch','finally','from','while'].includes(val))space=true;
    if([',',';',')',']','.','?.'].includes(val)||prevVal==='.'||prevVal==='?.'||prevVal==='['||prevVal==='(')space=false;
    if(val===':'&&!ops.has(start))space=false;
    if(!ops.has(start)&&prevVal==='('&&val==='-')space=false;
  }
  if(!line)line='  '.repeat(Math.max(0,level)+(soft.has(start)?1:0));else if(space)line+=' ';
  line+=val;
  if(inc.has(start))level++;
  if(token.isComment&&token.type==='Line')finish();
  prev={val,start,end,isComment:token.isComment};
 }
 finish();
 const ignore=(k,v)=>['loc','start','end','raw'].includes(k)?undefined:v;
 try{const test=acorn.parse(output,opts);if(JSON.stringify(test,ignore)!==JSON.stringify(ast,ignore))throw Error('AST mismatch');fs.writeFileSync(dir+file,output);console.log(file,output.split('\n').length)}catch(e){console.error(file,e.message);process.exitCode=1}
}
