/**
 * Help of the high level synthesis and neural network pages, and the sections shared by the three pages, in English.
 */
import { cite } from '../refs.js';

const c = (...keys) => keys.map((k) => `<a class="cite" href="#h-refs">${cite(k, 'en')}</a>`).join('; ');

export const heads = {
    hls: {
        title: 'Approximate high level synthesis',
        lead: 'A C kernel with Vitis HLS directives is elaborated, scheduled and bound to the units of the synthesized library. The page estimates latency, area, LUTs and energy, propagates the error of the approximate units to the outputs and searches for the cheapest unit assignment under an error bound. The model was calibrated against Vitis HLS and Vivado 2022.2.',
    },
    lenet: {
        title: 'Approximate neural network',
        lead: 'An 8 bit quantized LeNet-5 classifies 1000 MNIST digits with the multipliers and adders of the library, layer by layer, and shows the effect on accuracy.',
    },
};

export const sections = [
    {
        id: 'hls-start',
        title: 'Getting started',
        html: `
<ol>
    <li>Pick an <strong>example</strong> (Gaussian, Sobel, sharpening, FIR, dot product) or write your own kernel in the editor, and click <strong>Synthesize</strong> (or Ctrl+Enter).</li>
    <li>The <strong>Report</strong> shows the latency, the achievable period, the resources and the area and energy per part. <strong>Schedule</strong> and <strong>DFG</strong> show in which cycle each operation happens.</li>
    <li>In the <strong>Approximation</strong> tab, replace the additions and multiplications with approximate units from the library and see the estimated and measured error at the outputs, with the images.</li>
    <li>In the <strong>Exploration</strong> tab, set an objective (area, LUTs, energy, latency) and an error constraint (PSNR, MSE or SSIM), and let the search choose the units.</li>
    <li><strong>IR</strong> shows the elaborated design (loops, segments, widths); <strong>Library</strong> shows the synthesized units and downloads the Verilog of each one.</li>
</ol>
<p class="tip">To start: the Gaussian with a 5 ns period. In Approximation, put MUL8 DRUM6 on every multiplication and compare the estimated PSNR with the measured one; then run the Exploration with a 40 dB PSNR and the LUT objective, with the Vivado delays.</p>
<p>The code, the controls and the tab are kept in the browser. The units page opens a library unit through the <strong>Open in the units page</strong> button.</p>`,
    },
    {
        id: 'hls-lang',
        title: 'Kernel and directives',
        html: `
<p>The kernel is a function in a subset of C. The array parameters are the memories (input, output or both); there are no scalar parameters, sizes come from <code>#define</code>.</p>
<dl>
    <dt>Types</dt><dd><code>u8 u16 u32 i8 i16 i32</code>, and the equivalent names (<code>int</code>, <code>unsigned</code>, <code>uint8_t</code>, <code>int16_t</code> ...). Arrays of 1 or 2 dimensions; <code>const</code> tables with initial values become ROMs or constants.</dd>
    <dt>Statements</dt><dd><code>for</code> with constant bounds and an optional label (<code>cols:</code>), assignments, <code>+=</code> and the like, the <code>?:</code> operator, <code>min</code>, <code>max</code> and <code>abs</code>. There is no <code>if</code> or <code>while</code>: a condition becomes a selection with <code>?:</code>.</dd>
    <dt>Operations</dt><dd>addition, subtraction, multiplication, shift by a constant, division and remainder by a power of 2, logic operations and comparisons. The width of each operation comes from range analysis, not only from the type: a product of two unsigned 8 bit values uses the 8 bit multiplier even when the accumulator is <code>u32</code>.</dd>
</dl>
<p>The directives are those of Vitis HLS, written the same way:</p>
<table>
    <tr><th>Directive</th><th>Effect in the model</th></tr>
    <tr><td><code>#pragma HLS pipeline II=n</code></td><td>modulo pipelining of the loop; inner loops are fully unrolled. The final II is the largest of the requested one, the resource bound (memory ports, limited units) and the recurrence bound.</td></tr>
    <tr><td><code>#pragma HLS unroll</code> or <code>unroll factor=n</code></td><td>replicates the loop body (fully or n times). Each copy is a new operation in the Approximation tab; the Exploration can treat the copies together.</td></tr>
    <tr><td><code>#pragma HLS array_partition variable=v type=cyclic|block|complete factor=n dim=d</code></td><td>splits the memory into banks, each with the ports chosen in <strong>Ports per bank</strong>. A factor that is not a power of 2 costs a division by a constant in the address and a remainder in the bank selection.</td></tr>
    <tr><td><code>#pragma HLS allocation operation instances=mul|add limit=n</code></td><td>limits the number of units of that class; operations are shared, with multiplexers at the inputs.</td></tr>
</table>
<p>Elaboration is a symbolic execution: it unrolls the requested loops, folds constants (a product by a constant of array <code>K</code> becomes a constant multiplication), recognizes affine indices (which give the bank of each access), removes common subexpressions and computes the range of each value. The result is shown in the IR tab.</p>`,
    },
    {
        id: 'hls-cost',
        title: 'Report: latency, resources and cost',
        html: `
<p>The controls below the editor change the synthesis:</p>
<dl>
    <dt>Period</dt><dd>the target clock. Operations chained in one cycle must fit in the period minus the register time; an operation slower than the period becomes a multicycle operation.</dd>
    <dt>Unit synthesis</dt><dd>which of the three ASIC flows of the library gives the area, delay and energy of each unit (minimum delay, minimum area or iso delay).</dd>
    <dt>Delays</dt><dd><strong>sky130 (ASIC)</strong> schedules with the ASIC synthesis delays; <strong>Vivado (FPGA)</strong> uses the delays measured in Vivado with each unit between registers (<code>data/vivado-units.json</code>). With the Vivado delays, the 8 bit multiplication takes a whole cycle at 5 ns, as in Vitis, and the schedule gets closer to what Vitis does. LUTs and CARRY4 come from Vivado in both cases, when the characterization exists.</dd>
    <dt>Ports per bank</dt><dd>1 or 2 ports in each memory bank (in Vitis, <code>ram_1p</code> or <code>ram_t2p</code>).</dd>
</dl>
<p>The report has the summary (latency in cycles and time, interval between results, minimum period, area, LUTs, energy per run), the <strong>loops</strong> (trip count, requested and achieved II, depth, latency; a flattened loop shows as <code>rows_cols</code>, as in Vitis), the <strong>resources</strong> (units per type and instance, multiplexers, registers, memory and control logic) and the <strong>area and energy per part</strong>.</p>
<p>The cost is a pre synthesis estimate built from measured parts:</p>
<ul>
    <li>each library unit with the cost of its netlist after constant propagation: a multiplier with a constant operand, or with high bits that range analysis knows are zero, gets smaller;</li>
    <li>exact multiplication by a constant as a sum of shifts (signed digit representation), not shared, as Vitis does; the same rule holds for exact and approximate units: adders are not shared, and multiplications between variables are only when the shared instances with their multiplexers cost less;</li>
    <li>multiplexers at the inputs of shared units, registers for the lifetime of each value (with chains of 3 or more stages in SRLs on FPGA), loop counters, addresses and bank selection.</li>
</ul>
<p>The <strong>Model and limitations</strong> box, at the end of the tab, lists the assumptions with the numbers of the cells used. Over the 59 validation cases, the mean model error against Vivado is 0.3% for pipelined latency, 8% without pipelining, 15% for LUTs, 21% for FFs and about 18% for the period (details in the validation section). The numbers are meant to compare designs with each other; the final decision needs the full synthesis.</p>`,
    },
    {
        id: 'hls-sched',
        title: 'Schedule and DFG',
        html: `
<p>The <strong>Schedule</strong> is a Gantt chart of each segment (a loop body after unrolling): each column is a cycle, and operations chained in the same cycle appear one after the other on the time scale. The light band at the end of the cycle is the register time (clock to output and setup). With pipelining, the vertical lines mark the II: operations of the following iterations start there.</p>
<p>The <strong>DFG</strong> is the data flow graph of the same segment, in layers by start cycle. Boxes show the operation and the chosen width; the color tells the kind (memory, multiplication, addition, logic). The dashed edge is a recurrence: the value passed from one iteration to the next, like the accumulator of a FIR, which bounds the II.</p>
<p>Both change with the period, the delays (ASIC or FPGA) and the units chosen in Approximation: a faster approximate unit may fit in the same cycle as another operation and reduce the depth; a slower one, like DRUM with its leading one detector on the path, may need one more cycle.</p>`,
    },
    {
        id: 'hls-err',
        title: 'Approximation and error model',
        html: `
<p>The <strong>operations</strong> table lists each addition and multiplication of the DFG after unrolling. Each one can use any library unit of its width; the group row changes every operation of the same source line, and <strong>All exact</strong> undoes everything. Subtractions and signed additions are included too: in two’s complement, the same unit does the signed addition, and a subtraction is computed as ~(~a + b), with no carry in; they stay exact only when the result does not fit the width of the unit. Each operation shows its own error (that of the unit over the actual operands of that operation: a multiplier errs differently with coefficient 19 and with 52) and the error it alone would cause at the output.</p>
<p>The <strong>input data</strong> are the test image, uniform values over the range of each type or your own image (PNG, JPEG, PGM or PPM, converted to gray and fitted to the kernel size). The <strong>error model</strong> can be:</p>
<ul>
    <li><strong>analytic</strong>: the mean and second moment of the error of each node are propagated by the rules of each operation, with errors assumed independent of each other and of the signals;</li>
    <li><strong>sampled</strong>: in each segment, up to 2048 runs stored in the exact profile are replayed with the approximate units. Correlations inside the segment (error depending on the low bits of the operands, an adder that already zeroed the low bits) stay in the model; error coming from other segments enters as noise with the propagated mean and variance.</li>
</ul>
<p>Both are static: they do not run the whole approximate kernel, which is why they serve the search. In <strong>Outputs</strong>, each output shows the estimate and the <strong>measured</strong> value, the latter from the bit exact execution of the elaborated design with the functional models of the units: ME (mean error), MSE, PSNR and, for image outputs, SSIM. The images show the exact output, the approximate one and the difference map.</p>
<h3>SSIM</h3>
<p>SSIM (${c('wang2004')}) compares luminance, contrast and structure in local windows and follows perception better than PSNR: a small constant error lowers PSNR a lot and barely changes SSIM, and noise on the edges does the opposite. The implementation is the standard one: 11 × 11 Gaussian window with σ = 1.5, only at positions where the window fits entirely, K1 = 0.01 and K2 = 0.03.</p>
<p>The estimated SSIM does not need the approximate image. The sampled model measures the mean and variance of the error in 32 bins of the exact output value; with the local means and variances of the exact image, computed once, each window receives the error of the bins of its pixels. An error concentrated on high values (saturation) or on edges thus enters where it happens. The tab shows the estimated and measured pair; the typical difference on the examples is a few thousandths (experiment E7 in <code>docs/METODOLOGIA.md</code>).</p>
<p>The <strong>Error model and verification</strong> box, at the end of the tab, describes the rules of each operation, recurrences and memory.</p>`,
    },
    {
        id: 'hls-dse',
        title: 'Design space exploration',
        html: `
<p>Each point of the exploration is an assignment of units to the additions and multiplications and, with the options, a directive variant and a period. The point is synthesized again (sharing, multiplexers, registers and II enter the cost), and the error comes from the static model of the Approximation tab, with the same input data.</p>
<dl>
    <dt>Objective</dt><dd>ASIC area, LUT + CARRY4, energy per run, latency, interval between results, or a weighted sum of area, energy and latency, each divided by that of the exact design. For FPGA, use LUTs with the Vivado delays: on FPGA, approximating additions rarely saves anything, because the native adder uses the carry chain.</dd>
    <dt>Constraint</dt><dd>minimum PSNR, maximum MSE or minimum SSIM, on every output. SSIM only applies when there is an 8 bit image output.</dd>
    <dt>Groups</dt><dd>the unit is chosen <em>per class</em> (all 8 bit multiplications together), <em>per source line</em>, <em>per source operation</em> (the copies of an unrolled loop get the same unit, like a replicated operator) or <em>per operation</em>. With unrolling, the per operation search tends to approximate a single copy and leave the others exact, which concentrates the error in part of the output; per source operation, the decision holds for every copy and the space has the size of the kernel without unrolling.</dd>
    <dt>Heuristic</dt><dd><em>efficiency</em> (at each step, the swap with the largest saving per error increase), <em>sequential</em> (group by group, in source order), <em>exhaustive with pruning</em> (the model optimum when the space is small), <em>random</em> (reference), the improvement ones, which start from the result of efficiency and from the per class optimum and never end worse than either: <em>local search</em>, <em>tabu search</em>, <em>GRASP</em> and <em>genetic algorithm</em>, or <em>compare all</em>. Per operation, the improvement heuristics find better points than efficiency, at the price of more evaluations.</dd>
    <dt>Periods, directives and units</dt><dd>a list of periods (comma separated) and the option to vary the directives add those dimensions; <strong>all units</strong> disables the front that keeps, in each group, only the units not dominated in saving in context and own error. Units that never err on any sample of the operations are always dropped: synthesis would turn them into the same circuit as the exact one.</dd>
</dl>
<p>The best point of each heuristic is verified bit by bit; if the measured error exceeds the bound, the next feasible point in cost order is verified. The <strong>step by step</strong> view replays the search iteration by iteration, explaining each choice, and the <strong>Pareto front</strong> lists the non dominated points, with CSV and JSON export. The <strong>How the exploration works</strong> box details each heuristic.</p>`,
    },
    {
        id: 'hls-vitis',
        title: 'Validation with Vitis HLS and Vivado',
        html: `
<p>The script <code>scripts/vitis.mjs</code> writes each design in C++ for Vitis HLS 2022.2, with testbench, Tcl and the model predictions. In the <code>_ir</code> case, the C++ is the design elaborated by the simulator (same loops, directives and widths), so the comparison measures the cost model; in the <code>_src</code> case, the original code goes. The reference for resources and period is Vivado after placement and routing (<code>export_design -flow impl</code>), on part <code>xc7a100tcsg324-1</code>, with multiplications in LUTs.</p>
<p>Approximate units can go to Vitis in four forms:</p>
<table>
    <tr><th>Form</th><th>How</th><th>Result</th></tr>
    <tr><td><code>_ir</code></td><td>netlist rewritten in C++, function with <code>INLINE off</code></td><td>Vitis splits the unit into stages: more cycles and more FFs</td></tr>
    <tr><td><code>_lat0</code></td><td>the same function with <code>LATENCY max=0</code></td><td>combinational unit, exact latency</td></tr>
    <tr><td><code>_inl</code></td><td>the function inlined (<code>INLINE</code>)</td><td>Vitis optimizes the netlist together with the rest</td></tr>
    <tr><td><code>_rtl</code></td><td>RTL blackbox (<code>add_files -blackbox</code>) with the library Verilog</td><td>Vivado synthesizes exactly the characterized unit</td></tr>
</table>
<p>The RTL blackbox is the reference form: it reproduces the characterized unit and is the one the model describes best (the predicted saving errs by 8.0 percentage points on average over the 14 designs measured this way, against 16.5 for the best C++ form). In the fourth round, four points chosen by the exploration with the current model were 9% to 69% smaller than the exact design, with the predicted saving 3.6 points from the measured one on average; but the model does not reliably rank neighboring points of the front, so it is worth measuring the two or three cheapest. A limitation: Vitis does not know the blackbox delay and chains it as if it were instantaneous, so the Vivado period may get worse (7.0 ns for the Gaussian with DRUM6).</p>
<p>In the 59 cases of the four rounds, the Vitis csim gives the same output as the bit exact execution of the simulator at every position. The reports are in <code>results/vitis/</code>, and <code>node scripts/vitis.mjs compare</code> redoes the comparison with the current model without Vitis. The full analysis, round by round, is in <code>docs/METODOLOGIA.md</code>, section 6.</p>`,
    },
    {
        id: 'hls-cli',
        title: 'Command line and reproduction',
        html: `
<p>Everything the page does is available from the command line, with Node, for larger and reproducible studies:</p>
<pre>node bin/axc.mjs hls --example gauss --approx "mul8=MUL8 DRUM6" --error --json
node bin/axc.mjs dse kernel.c --psnr 40 --heuristic all --granularity source --csv
npm run experiments          # case studies E1 to E7, output in results/
npm run vitis:export         # designs for Vitis HLS, in build/vitis/
npm run vivado:units         # characterization of the units in Vivado</pre>
<p>The experiments write one CSV per study, the tables in Markdown and LaTeX and the metadata (date, commit, versions). Seeds, data and the library are in the repository: the same commit gives the same numbers. Assumptions, threats to validity and the validation procedure are in <code>docs/METODOLOGIA.md</code>.</p>`,
    },
    {
        id: 'nn-start',
        title: 'Getting started',
        html: `
<ol>
    <li>Choose the <strong>multiplier</strong> and, optionally, the <strong>accumulation adder</strong> among the library units. From the units page, the <strong>Use in LeNet-5</strong> button opens this page with the unit from there.</li>
    <li>Check the <strong>layers</strong> that use the approximate units; the others stay exact.</li>
    <li>On every change, the page classifies the images again and shows the accuracy on the 1000 images, against that of the exact network, the confusion matrix and the digits that started to fail.</li>
    <li>The <strong>sensitivity</strong> button approximates one layer at a time and shows how much accuracy each one costs and how many multiplications it does.</li>
</ol>
<p class="tip">To start: MUL8 Mitchell on every layer barely changes the accuracy; with bias compensation, accuracy drops about 4 points, although the mean error of the unit is smaller.</p>`,
    },
];

/** Sections shared by the three pages. */
export const common = [
    {
        id: 'figs',
        title: 'Exporting figures',
        html: `
<p>Hover over any chart, diagram or image: <strong>SVG</strong> and <strong>PNG</strong> buttons appear in the corner of the figure. The SVG comes with colors and fonts written on each element, always in the light theme and on a white background, ready for a vector editor or for LaTeX (through Inkscape or the <code>svg</code> package). The PNG comes at twice the screen resolution.</p>
<p>Heat maps and images are drawn pixel by pixel (canvas): their SVG carries the embedded image, without smoothing, and the PNG has the original size. The file name comes from the nearest title or caption of the figure.</p>`,
    },
    {
        id: 'pages',
        title: 'The three pages',
        html: `
<dl>
    <dt><a href="./index.html">Units</a></dt><dd>an approximate adder or multiplier gate by gate: structure, error map, metrics, cost, Pareto, voltage and memory, stochastic computing.</dd>
    <dt><a href="./lenet.html">Neural network</a></dt><dd>LeNet-5 on MNIST with the library units, layer by layer.</dd>
    <dt><a href="./hls.html">High level synthesis</a></dt><dd>whole C kernels with directives: scheduling, cost, output error, exploration and the synthesized library.</dd>
</dl>
<p>Each page has its own help, under the <strong>Help</strong> button in the header; the references are the same.</p>`,
    },
];
