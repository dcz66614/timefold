# 第三方开源软件声明与许可证说明 (Third-Party Software Notices)

本项目 **P009 时隙镜 TimeFold**（2026 夏令时公历跳折反像与固定 UTC 漂移对照器）使用以下第三方开源软件与开发依赖。特此依照各开源许可证之条款，列出所有依赖包之锁定版本、开源许可证类型、项目用途及源码仓库 URL，并附录相关许可证全文。

---

## 1. 独立研发与边界声明 (Non-Appropriation Statement)

- **核心算法第一方实现**：本项目所有公历日期运算、时区分段反像映射、夏令时春跳（Gap）与秋折（Fold）判定、周期日程展开及基准漂移计算等核心逻辑（`src/core/`、`src/worker/`），均为独立原创研发，**未挪用、复制或内联任何 `rrule.js`、`Temporal`、`date-fns`、`moment-timezone` 或 `luxon` 之源码**。
- **UI 与交互设计**：界面全部组件及样式（`src/ui/`）均为原生 React 19 + 纯 CSS 第一方自主构建，未使用任何第三方 UI 库或抄袭他人交互界面。
- **参考规范与学术文献**：项目开发过程中参考的 RFC 5545 (iCalendar)、RFC 2445、ECMA-402 (Intl.DateTimeFormat) 以及 TC39 Temporal 规范，仅作为学习依据与真值对比基准，并不构成代码复制或衍生许可。

---

## 2. 直接依赖清单 (Direct Dependencies)

### 2.1 运行时依赖 (Production Dependencies)

| 依赖包名称 | 锁定版本 | 许可证 | 项目用途 | 源码仓库 / 主页 |
|---|:---:|:---:|---|---|
| **react** | `19.3.1` | MIT | 前端 UI 视图层声明式渲染与响应式状态组件驱动 | [https://github.com/react/react.git](https://github.com/react/react.git) |
| **react-dom** | `19.3.1` | MIT | React DOM 客户端宿主环境渲染与挂载适配器 | [https://github.com/react/react.git](https://github.com/react/react.git) |

### 2.2 开发与构建测试依赖 (Development & Test Dependencies)

| 依赖包名称 | 锁定版本 | 许可证 | 项目用途 | 源码仓库 / 主页 |
|---|:---:|:---:|---|---|
| **@playwright/test** | `1.64.1` | Apache-2.0 | 离线端到端浏览器自动化、零外联断言与 90 请求性能基准测试框架 | [git+https://github.com/microsoft/playwright.git](https://github.com/microsoft/playwright.git) |
| **@types/node** | `24.19.2` | MIT | Node.js 24.x 运行时环境与原生模块的 TypeScript 静态类型声明 | [https://github.com/DefinitelyTyped/DefinitelyTyped.git](https://github.com/DefinitelyTyped/DefinitelyTyped.git) |
| **@types/react** | `19.3.0` | MIT | React 19 核心 API 与 JSX 语法树的 TypeScript 类型定义 | [https://github.com/DefinitelyTyped/DefinitelyTyped.git](https://github.com/DefinitelyTyped/DefinitelyTyped.git) |
| **@types/react-dom** | `19.3.0` | MIT | React DOM 客户端挂载与事件系统的 TypeScript 类型定义 | [https://github.com/DefinitelyTyped/DefinitelyTyped.git](https://github.com/DefinitelyTyped/DefinitelyTyped.git) |
| **@vitejs/plugin-react** | `5.1.4` | MIT | Vite React 快速热重载、Babel JSX 转换与构建优化插件 | [git+https://github.com/vitejs/vite-plugin-react.git](https://github.com/vitejs/vite-plugin-react.git) |
| **typescript** | `5.9.3` | Apache-2.0 | 静态类型系统检查器 (`tsc --noEmit`) 与代码契约编译工具 | [https://github.com/microsoft/TypeScript.git](https://github.com/microsoft/TypeScript.git) |
| **vite** | `7.3.7` | MIT | 前端现代化极速构建工具与本地预览静态服务器 | [git+https://github.com/vitejs/vite.git](https://github.com/vitejs/vite.git) |
| **vitest** | `4.1.12` | MIT | 高性能单元测试、数学不变量测试与独立 Oracle 测试执行框架 | [git+https://github.com/vitest-dev/vitest.git](https://github.com/vitest-dev/vitest.git) |

---

## 3. 间接依赖汇总 (Transitive Dependencies Summary)

经 `package-lock.json` 全量依赖图分析，本项目共解析 151 个间接依赖包。各包许可证统计如下：

- **MIT License**：137 个包（包括 esbuild, rollup, @babel 家族, pathe, picocolors 等）
- **Apache License 2.0**：6 个包（包括 @playwright 内部辅助库）
- **ISC License**：6 个包（包括 semver, picomatch 等）
- **BSD 3-Clause License**：1 个包
- **CC-BY-4.0**：1 个包（caniuse-lite）

所有间接依赖均为业界广泛采用的规范开源工具链组件，无 GPL、AGPL 等强传染性开源协议，完全兼容商业使用与教学分发。

---

## 4. 许可证全文附录 (Full License Texts)

### 4.1 The MIT License (MIT)

```text
The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 4.2 Apache License, Version 2.0

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.
      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work.

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or exemplary damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.
```

### 4.3 The ISC License (ISC)

```text
ISC License

Copyright (c) 2004-2010 by Internet Systems Consortium, Inc. ("ISC")
Copyright (c) 1995-2003 by Internet Software Consortium

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### 4.4 The 3-Clause BSD License (BSD-3-Clause)

```text
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
