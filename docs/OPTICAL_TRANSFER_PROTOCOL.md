# LMFT/1 光学文件传输协议规格

LMFT/1 是 LanMind 自有的光学文件线上协议，不是外部标准的别名。RaptorQ 算法遵循 RFC 6330；外层文件、对象和包格式按本文实现。协议变更必须与解析器、固定向量和版本号一起评审，避免新版本无法恢复旧版本已经生成的传输数据。

本协议只定义屏幕二维码中传输的字节。接收进度如何保存在本机属于实现细节；LMFT/1 不定义 LMSA、ZIP、APNG 或其他会话归档与动画载体。

## 1. 术语、数字与限制

- transfer：一个原文件的一次冻结传输，由随机 128-bit transferId 标识。
- generation：一个原始文件块；不同块独立压缩、加密和喷泉编码。
- object：喷泉码恢复的一段不可变字节，可以是 descriptor、manifest 或数据块的线上表示。
- symbol：固定 T 字节的 source 或 repair 符号。
- QR packet：LMFT 头、一个符号和尾校验；当前产品每个屏幕画面显示一个 QR packet。
- F：object 的线上长度；K=ceil(F/T) 为源符号数量。
- 除特别注明外，多字节整数使用无符号小端；SHA 输出按标准字节顺序，不转整数。
- 64-bit 字段使用 BigInt/DataView 解析，经过资源和安全检查后才能转为 Number。
- 1 GiB 是产品建议操作上限和发布容量验收覆盖线，不是协议硬限制。
- v1 原始块允许 256 KiB、512 KiB、1 MiB、2 MiB、4 MiB；块数最多 4096。
- descriptor 线上长度固定 128 字节；manifest 线上长度最多 2 MiB；数据 object 最多 4 MiB+16 字节。
- v1 数据 T 允许 448、704、960、1408、1856；控制 T 固定 256，均按 8 字节对齐。
- 所有长度、块数、文件名、解压长度和符号数量必须先检查再分配内存。

超过 1 GiB 的文件只要仍满足块数、字段、存储和运行环境限制，就可以使用同一协议。产品可以因可用空间或当前环境能力不足拒绝，但不能仅以“文件超过 1 GiB”作为协议错误。预计耗时只用于操作提示。

## 2. 对象模型

| kind | objectId | 内容 | 是否可加密 |
| ---: | ---: | --- | --- |
| 0 | 0 | 公开 descriptor | 否 |
| 1 | 1 | 文件 manifest | 随传输加密开关 |
| 2 | generationIndex+2 | 独立原始块或 zstd 块 | 随传输加密开关 |

generationIndex 从 0 开始。kind 和 objectId 必须符合上表，其他组合拒绝。每个线上 object 的 SHA-256 由冻结的实际字节计算；加密对象的线上字节包含 GCM tag。

descriptor 确认 manifest 的完整线上 SHA-256；manifest 确认每个数据 object 的线上 SHA-256、原始块 SHA-256 和整文件 SHA-256。QR 识别成功或喷泉恢复成功都不能替代完整性验证。

## 3. QR packet

packet 由 64 字节固定头、T 字节符号和 4 字节尾校验组成。

### 3.1 固定头

| 偏移 | 长度 | 名称 | 定义 |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII LMFT：4C 4D 46 54 |
| 4 | 1 | wireVersion | 1 |
| 5 | 1 | kind | 0、1、2 |
| 6 | 2 | headerLength | 64 |
| 8 | 16 | transferId | 所有对象一致的随机原始字节 |
| 24 | 4 | objectId | 见对象模型 |
| 28 | 4 | encodedLength | F，截断补零前的线上对象长度 |
| 32 | 2 | symbolSize | T |
| 34 | 1 | fecProfile | 1 |
| 35 | 1 | flags | v1 固定 0 |
| 36 | 16 | objectTag | SHA-256(线上 object) 的前 16 字节 |
| 52 | 1 | SBN | RFC 6330 Source Block Number，固定 0 |
| 53 | 3 | ESI | RFC 6330 Encoding Symbol ID，24-bit 大端 |
| 56 | 4 | reserved | 全 0 |
| 60 | 4 | headerCrc32c | CRC32C(bytes[0..60))，小端 |
| 64 | T | symbol | 固定长度符号，末 source symbol 用 0 补齐 |
| 64+T | 4 | packetCrc32c | CRC32C(bytes[0..64+T))，小端 |

QR 解码获得的字节数必须恰好为 68+T。packet 不再套 Base64、JSON 或文本前缀。SBN 与 ESI 可直接组成 RFC 6330 FEC Payload ID；ESI 的大端编码与其他头字段的小端编码不同。

### 3.2 CRC32C

CRC32C 使用 Castagnoli 反射多项式 0x82F63B78，init=0xFFFFFFFF，xorout=0xFFFFFFFF。ASCII `123456789` 的结果为 0xE3069283，空输入为 0。

header CRC 用于在分配对象前排除损坏参数，packet CRC 覆盖头和符号。CRC 是误码检查，不是密码学认证；QR Reed-Solomon、CRC、RaptorQ 和 SHA-256 各自承担不同职责。

### 3.3 接收顺序

1. 检查最短长度、magic、wireVersion 和 headerLength。
2. 验证 header CRC，再读取并限制 kind、F、T、fecProfile 和保留字段。
3. 检查 packet 总长度和 packet CRC。
4. 检查 kind/objectId 组合、对象 F 上限、SBN、ESI 和已知 descriptor 约束。
5. 形成 streamKey，按 ESI 去重后交给 RaptorQ。

streamKey 至少包含 wireVersion、kind、transferId、objectId、objectTag、F、T、fecProfile。不能只用 transferId 或块编号作为解码矩阵键。

同一 streamKey/ESI 的完全重复包忽略；相同编号但内容不同的包报告冲突。只有通过 manifest 完整哈希确认的数据 object 才能成为完成块。

## 4. RaptorQ profile 1

| 参数 | 值 |
| --- | --- |
| F | object 线上长度 |
| T | packet header 中的 symbolSize |
| Al | 8 |
| Z | 1 source block |
| N | 1 sub-block |
| SBN | 0 |
| K | ceil(F/T) |
| source ESI | 0 到 K-1 |
| repair ESI | K 到 0xFFFFFF |

最后一个 source symbol 用 0 补足 T，恢复后只取前 F 字节。线上 ESI 使用 RFC 6330 的 ESI，不用库内部编号或自定义随机种子替代。

接收端同时接受 source 和 repair symbols。发送端可以在有界预算内生成 source/repair 集合并循环播放，也可以在依赖支持且资源允许时增加新的 repair symbols。重复播放只能补到此前未识别的符号，不增加集合本身的纠错信息。晚到的接收端在得到足够不同的 repair symbols 后可以恢复，但有限集合不保证任意丢包情况下都成功。达到 K 个不同符号不保证已经完成，解码器必须返回明确的 NEED_MORE、COMPLETE、INVALID 或 RESOURCE_LIMIT 状态。

ESI 超过 0xFFFFFF 时不得回绕。FPS 和 QR ECC 改变不影响 streamKey；T 改变会改变编码关系，必须建立新的 transfer。

## 5. 公开 descriptor

descriptor 使用 magic `LMDS`，固定 128 字节。

| 偏移 | 长度 | 字段 | 说明 |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII LMDS |
| 4 | 1 | version | 1 |
| 5 | 1 | cryptoSuite | 0=无加密，1=AES-256-GCM |
| 6 | 1 | kdf | 0=无，1=PBKDF2-HMAC-SHA-256 |
| 7 | 1 | reserved | 0 |
| 8 | 16 | transferId | 与 packet header 相同 |
| 24 | 16 | salt | 加密时随机 16 字节；未加密时全 0 |
| 40 | 4 | iterations | 加密时 600000；未加密时 0 |
| 44 | 8 | noncePrefix | 加密时随机 8 字节；未加密时全 0 |
| 52 | 4 | rawBlockSize | 合法原始块大小 |
| 56 | 4 | blockCount | ceil(originalSize/rawBlockSize)，空文件为 0 |
| 60 | 8 | originalSize | 原文件字节数 |
| 68 | 4 | manifestWireLength | 线上 manifest 长度 |
| 72 | 32 | manifestWireSha256 | 线上 manifest 完整哈希 |
| 104 | 2 | dataSymbolSize | 数据对象 T |
| 106 | 2 | controlSymbolSize | 固定 256 |
| 108 | 4 | flags | 0 |
| 112 | 16 | reserved | 全 0 |

descriptor 使用控制 T=256，F=128，K=1。实现必须正确处理 K=1，并持续重复或产生合法 repair symbols，使中途加入者能够恢复控制信息。

解析时检查字段组合。未加密 descriptor 不允许非零 KDF 参数；未知加密套件不能按未加密处理。v1 只接受固定迭代次数，防止恶意参数触发任意耗时 KDF。

### 5.1 加密上下文

manifest 记录数据密文哈希，descriptor 又记录 manifest 密文哈希，因此生成密文时不能依赖 descriptor 的最终完整哈希。

~~~text
context = SHA256(
  UTF8("LMFT-CONTEXT-v1" + NUL)
  || descriptor[0..68)
  || descriptor[104..128)
)
~~~

准备时先确定其余 descriptor 字段并计算 context，再生成数据 object 和 manifest，最后补全 manifestWireLength、manifestWireSha256 并冻结 descriptor。未补全的 descriptor 不得发送。

## 6. 文件 manifest

manifest 使用 magic `LMFM`。manifest 不使用 zstd；未加密时线上字节就是明文，加密时为 AES-GCM ciphertext 加 16 字节 tag。

### 6.1 固定头

| 偏移 | 长度 | 字段 |
| ---: | ---: | --- |
| 0 | 4 | magic=ASCII LMFM |
| 4 | 2 | version=1 |
| 6 | 2 | flags=0 |
| 8 | 16 | transferId |
| 24 | 8 | originalSize |
| 32 | 4 | rawBlockSize |
| 36 | 4 | blockCount |
| 40 | 2 | fileNameLength，UTF-8 字节数 |
| 42 | 2 | mimeLength，UTF-8 字节数 |
| 44 | 32 | originalFileSha256 |
| 76 | 4 | reserved=0 |
| 80 | 可变 | 文件名、MIME、按块编号排序的记录 |

manifest 明文长度必须恰好等于 `80 + fileNameLength + mimeLength + 88 * blockCount`，不接受尾随数据。文件名必须是非空 basename，最多 1024 UTF-8 字节；MIME 最多 255 字节，空值归一为 `application/octet-stream`。

文件名在发送和保存时都处理路径分隔符、控制字符和保留名称。非法 UTF-8 拒绝，正常 Unicode 不损坏。名称只作为建议保存名，不作为本地路径。

### 6.2 每块记录

每条记录固定 88 字节。

| 记录内偏移 | 长度 | 字段 |
| ---: | ---: | --- |
| 0 | 4 | generationIndex |
| 4 | 8 | rawOffset |
| 12 | 4 | rawLength |
| 16 | 4 | wireLength |
| 20 | 1 | compression：0=none，1=zstd |
| 21 | 3 | reserved=0 |
| 24 | 32 | rawSha256 |
| 56 | 32 | wireSha256 |

记录连续排序，generationIndex 等于记录顺序，rawOffset 等于此前所有原始块长度之和。除末块外 rawLength 等于 rawBlockSize；末块为剩余长度，不存在空数据块。所有 rawLength 之和必须等于 originalSize。

未加密时 packedLength=wireLength；加密时 packedLength=wireLength-16。compression=none 要求 packedLength=rawLength；zstd 要求 packedLength 大于 0 并符合压缩收益规则。

descriptor 与 manifest 的 transferId、originalSize、blockCount 和 rawBlockSize 必须一致。manifest 未通过线上哈希以及必要的认证解密前，不得使用其名称和长度创建最终输出。

### 6.3 空文件

空文件使用 originalSize=0、blockCount=0，仍保留合法 rawBlockSize。originalFileSha256 为标准 SHA-256 空输入值。验证 manifest 后即可恢复，不创建虚假数据 object。

## 7. 压缩与加密

### 7.1 zstd profile

- 每块一个独立 zstd frame，不使用外部字典或跨块历史。
- 编码 level=3，写入 content size，并使用 frame checksum。
- windowLog 最大 22；解码器同时检查窗口上限、content size 和 manifest rawLength。
- 每块只允许一个 frame，不接受串联 frame、外部 dictionary 或无法解释的尾数据。
- 只有至少节约 `max(64, ceil(rawLength * 0.01))` 字节时选择 zstd，否则使用 none。
- 解压输出必须恰好为 rawLength；zstd checksum 不替代 SHA-256。

### 7.2 密钥与 nonce

密码按用户输入直接 UTF-8 编码，不 trim，不做 Unicode 归一化。KDF 为 PBKDF2-HMAC-SHA-256，salt=descriptor.salt，iterations=600000，输出 256-bit AES 密钥。空密码表示不启用加密。

AES-GCM 使用 128-bit tag。IV 为 noncePrefix 的 8 字节加 objectId 的 4 字节大端表示。objectId=1 用于 manifest，2 起用于数据；descriptor 不加密。

同一 transfer 下对象字节生成后冻结。同一密钥和 IV 不能用于不同内容。密码、原始数据、块边界或压缩表示变化时，必须创建新的 transferId、salt 和 noncePrefix。

准备未完成便取消或失败时，重试必须生成新的身份和加密参数。首版不要求发送会话跨重启恢复。

### 7.3 AAD

~~~text
AAD = UTF8("LMFT-AAD-v1" + NUL)
   || context[32]
   || kind:u8
   || objectId:u32LE
   || rawOffset:u64LE
   || rawLength:u32LE
   || compression:u8
   || packedLength:u32LE
~~~

数据对象字段来自已验证 manifest。manifest 使用 kind=1、objectId=1、rawOffset=0、compression=0，rawLength 和 packedLength 均为 manifestWireLength-16。

线上字节为 AES-GCM ciphertext 后接 tag，不另传 nonce。接收顺序固定为：检查密文长度和哈希、认证解密、解压、原始块哈希、最终整文件哈希。认证失败不能输出明文；错误密码可以重试。

## 8. 元数据与有限缓存

descriptor 和 manifest 与数据使用相同 packet 结构，并在发送循环中持续穿插。

- 没有 descriptor 时，只保留有界候选 transfer 和数据符号，优先接收控制 packet。
- descriptor 验证后锁定身份，manifest 必须符合 descriptor 的长度和完整哈希。
- manifest 未验证时，不信任数据块的文件语义；缓存达到预算后可以丢弃待确认数据，但继续扫描控制 packet。
- 加密 manifest 尚未解锁时同样受缓存预算限制。
- 控制信息齐全后，数据 packet 必须匹配 manifest 的对象编号、长度和哈希。
- 同一 transfer 出现不同 descriptor 时报告冲突，不能替换已有解码状态。

objectTag 只用于路由和提前拒绝。完整 object 仍需验证 32 字节 SHA-256；哈希不提供来源身份认证。

## 9. 本机恢复与输入合并

本机恢复不是新的线上协议。持久数据必须继续遵守 LMFT 的 transferId、streamKey、对象哈希和整文件哈希规则。

- 已验证块写入持久存储成功后才能记录为完成。
- 恢复时不序列化或还原 RaptorQ 内部指针；未完成对象可以重放有界、去重后的有效 packet，或重新扫描。
- 摄像头、录像、静态图片和宿主动图解码只提供新的 LMFT packet，统一按 streamKey/ESI 去重。
- 完成 object 可以删除对应 FEC 和 packet 缓冲；不得同时无限保留线上对象、明文块和解码矩阵。
- 加密会话的本机元数据不保存密码或密钥；任何用户可导出的 checkpoint 不得包含解密后的明文块。
- 块校验失败时保留其他已验证块，清理问题块后允许重新扫描。
- 不同 transfer 的进度不能仅凭文件名或文件哈希自动合并。

LMFT/1 不定义便携会话包。导出或导入 JSON、数据库记录或缓存目录都不能绕过本节的身份与哈希检查。

## 10. 版本、错误与固定向量

wireVersion、descriptor version 和 manifest version 分别版本化。v1 不接受非零保留字段；不兼容语义必须升级版本，不能猜测解析。

稳定错误分类至少包括：

- `UNSUPPORTED_WIRE_VERSION`
- `INVALID_HEADER`
- `PACKET_CRC_FAILED`
- `OBJECT_CONFLICT`
- `RESOURCE_LIMIT`
- `NEED_MORE_SYMBOLS`
- `OBJECT_HASH_FAILED`
- `PASSWORD_REQUIRED`
- `AUTH_FAILED`
- `DECOMPRESS_FAILED`
- `RAW_HASH_FAILED`
- `FILE_HASH_FAILED`
- `INCOMPATIBLE_SESSION`
- `UNSUPPORTED_MEDIA_CODEC`

测试至少包含以下固定输入或可重复种子：

1. CRC32C 已知向量、空文件、1 字节文件和包含 0 到 255 的二进制文件。
2. K=1、末符号补零、末块不足和多个完整块。
3. none/zstd、中文文件名、不同 MIME 和合法 T。
4. 固定密码、salt、noncePrefix、transferId 的 context、AAD、ciphertext、tag 和哈希。
5. source-only、repair-only、混合、乱序、重复和持续补充 repair symbols。
6. header/packet CRC 错误、保留字段非零、混合身份、错误密码、尾随字节和块记录篡改。

算法依赖使用精确 npm 版本和项目 lockfile。协议冻结要求已知向量和端到端负向测试，不要求 LanMind 仓库维护第二套 RaptorQ、QR 或 zstd 实现。
