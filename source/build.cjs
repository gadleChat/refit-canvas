const fs=require('fs'),path=require('path'),esbuild=require('esbuild');
const root=__dirname,vendor=path.join(root,'vendor/SDStudio');
// Extract these exported utility functions verbatim; leave the React component
// in the original source file as provenance. Also retain its 8px brush helpers.
const brush=fs.readFileSync(path.join(vendor,'src/renderer/componenets/BrushTool.tsx'),'utf8');
const functions=brush.slice(brush.indexOf('export function base64ToDataUri'),brush.indexOf('interface Props'));
const chunks=brush.slice(brush.indexOf('const CHUNK_SIZE = 8;'),brush.indexOf('const BrushTool = forwardRef'));
fs.writeFileSync(path.join(root,'adapters/upstream-mask-functions.ts'),'// Extracted verbatim from SDStudio BrushTool.tsx. See LICENSE-SDSTUDIO.txt.\n'+functions+chunks+'\nexport {getChunksInBrush,getChunksBetween};\n');
esbuild.build({entryPoints:[path.join(root,'sdstudio-host.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome110',outfile:path.join(root,'../static/sdstudio-core.js'),minify:true,sourcemap:true,legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'},nodePaths:process.env.BUILD_NODE_PATH?[process.env.BUILD_NODE_PATH]:[],plugins:[{name:'standalone-host-adapters',setup(build){
const aliases={'../../models':'backend.ts','../../componenets/BrushTool':'upstream-mask-functions.ts','libsodium-wrappers-sumo':'token-only.ts'};
build.onResolve({filter:/^(\.\.\/\.\.\/models|\.\.\/\.\.\/componenets\/BrushTool|libsodium-wrappers-sumo)$/},args=>({path:path.join(root,'adapters',aliases[args.path])}));
}}]}).catch(error=>{console.error(error);process.exit(1);});
