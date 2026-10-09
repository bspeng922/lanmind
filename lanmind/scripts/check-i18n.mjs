import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const base='src/i18n/locales';
const locales=fs.readdirSync(base).filter((name)=>fs.statSync(path.join(base,name)).isDirectory());
const modules=fs.readdirSync(path.join(base,'zh-CN')).filter((name)=>name.endsWith('.json')&&name!=='meta.json');
function flatten(value,prefix='',result={}) { for(const[key,item]of Object.entries(value)){const name=prefix?`${prefix}.${key}`:key;if(typeof item==='string')result[name]=item;else if(item&&typeof item==='object'&&!Array.isArray(item))flatten(item,name,result);else throw new Error(`Invalid translation: ${name}`);}return result; }
function params(value){return [...value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}|(?<!\{)\{([A-Za-z0-9_]+)\}(?!\})/g)].map((match)=>match[1]||match[2]).sort().join(',');}
const known=new Set();let count=0;
for(const locale of locales){const meta=JSON.parse(fs.readFileSync(path.join(base,locale,'meta.json'),'utf8'));if(meta.code!==locale||!meta.nativeName||!Array.isArray(meta.aliases)||!['ltr','rtl'].includes(meta.direction))throw new Error(`Invalid locale metadata: ${locale}`);
 const localeModules=fs.readdirSync(path.join(base,locale)).filter((name)=>name.endsWith('.json')&&name!=='meta.json');
 if(localeModules.sort().join(',')!==[...modules].sort().join(','))throw new Error(`Translation modules differ: ${locale}`);
 for(const module of modules){const baseline=flatten(JSON.parse(fs.readFileSync(path.join(base,'zh-CN',module),'utf8')));const data=flatten(JSON.parse(fs.readFileSync(path.join(base,locale,module),'utf8')));if(Object.keys(data).sort().join('\n')!==Object.keys(baseline).sort().join('\n'))throw new Error(`Translation keys differ: ${locale}/${module}`);
  for(const[key,value]of Object.entries(data)){if(!value.trim())throw new Error(`Empty translation: ${locale}/${module}:${key}`);if(params(value)!==params(baseline[key]))throw new Error(`Interpolation mismatch: ${locale}/${module}:${key}`);known.add(`${module.slice(0,-5)}:${key}`);count++;}
 }
}
function checkKey(key,file){if(!known.has(key)&&!known.has(`${key}_one`)&&!known.has(`${key}_other`))throw new Error(`Unknown translation key ${key} in ${file}`);}
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(entry.name!=='locales')walk(file);}else if(/\.tsx?$/.test(file)&&!file.endsWith('.test.ts')){
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(node){if(ts.isCallExpression(node)&&['tr','serverTr'].includes(node.expression.getText(source))){if(node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))checkKey(node.arguments[0].text,file);if(node.arguments[1]){function check(value){if(ts.isJsxElement(value)||ts.isJsxSelfClosingElement(value)||ts.isJsxFragment(value))throw new Error(`JSX cannot be used as a string interpolation in ${file}`);ts.forEachChild(value,check);}check(node.arguments[1]);}}ts.forEachChild(node,visit);}visit(source);
}}}
walk('src');
for(const entry of JSON.parse(fs.readFileSync('src/i18n/error-patterns.json','utf8')))checkKey(entry.key,'error-patterns.json');
console.log(`i18n: ${locales.length} locales, ${count} translations verified`);
