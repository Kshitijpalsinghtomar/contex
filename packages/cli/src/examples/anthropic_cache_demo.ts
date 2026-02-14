import Anthropic from '@anthropic-ai/sdk';
import { Tens } from '@contex/core';
import { injectContexContent } from '@contex/middleware';

// Mock performance if not available (e.g. some node envs)
const now = () => performance.now();

async function main() {
  console.log('--- Contex Anthropic Cache Demo ---');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set.');
    console.error('Please set it in .env or your environment.');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  // Use a model that supports prompt caching (Claude 3.5 Sonnet / Haiku / Opus)
  // Note: Prompt caching is generally available on standard models now.
  const model = 'claude-3-5-sonnet-20240620';

  // 1. Generate "Heavy" Data
  // We need enough tokens to make caching worthwhile.
  // Anthropic Cache has a minimum token count (e.g. 1024 for Haiku, maybe more for Sonnet?)
  // Let's generate ~5KB of data which is ~1.5k tokens.
  console.log('1. Generating heavy dataset (500 items)...');
  const data = Array.from({ length: 500 }, (_, i) => ({
    id: i,
    title: `Ticket #${i} - Critical System Failure in Module ${i % 10}`,
    description:
      `Detailed description of the issue encountered in module ${i % 10}. ` +
      `The system exhibited unexpected behavior during the load test phase. ` +
      `Error logs indicate a potential memory leak or race condition. ` +
      `Customer impact is rated as ${i % 3 === 0 ? 'High' : 'Medium'}. ` +
      `Please investigate immediately. `.repeat(2),
    status: i % 2 === 0 ? 'OPEN' : 'CLOSED',
    priority: i % 3 === 0 ? 'P0' : 'P1',
    tags: ['bug', 'backend', 'urgent', `v${i % 5}.0`],
  }));

  // 2. Encode to Contex IR (Tens)
  // This is the "Protocol Stabilization" part - using the clean SDK.
  console.log('2. Encoding to Canonical IR...');
  const tens = Tens.encode(data);
  console.log(`   Tens Hash: ${tens.hash.slice(0, 12)}...`);
  console.log(`   Canonical Text Length: ${tens.toString().length} chars`);

  // 3. Execution Helper
  const runInference = async (runName: string) => {
    console.log(`\n--- ${runName} ---`);
    const start = now();

    await injectContexContent(client, model, tens, async (payload) => {
      // Note: payload.text contains the canonical text.
      // For Anthropic Prompt Caching, we need to structure the message correctly with cache_control.
      // The middleware integration *should* handle this if we used `createContexAnthropic`.
      // But here we are using `injectContexContent` which gives us the payload to inject manually.
      // Currently `injectContexContent` returns { text } or { tokens }.
      // Does it return basic text? Yes.
      // Does it add cache headers? No, `injectContexContent` is low-level.
      // To get automatic caching headers, we should use `createContexAnthropic` OR manually construct the message.

      // Wait, the Phase 10 implementation of `createContexAnthropic` in `packages/middleware/src/anthropic.ts`
      // handles the `cache_control` injection automatically if content > 3500 chars!
      // So if we use `injectContexContent` we get the raw text.
      // If we want the automatic behavior, we should use the SDK wrapper.

      // Let's use the SDK wrapper pattern ideally?
      // The prompt "Phase 8" says: `contex inject ...` or `const tens = ...; tens.toString()`.
      // User wants "Real-world proof".

      // Let's manually construct the cached block to be explicit and show how it works "under the hood"
      // OR use the wrapper. The wrapper is "developer usability".

      // Let's stick to `injectContexContent` as the prompt requested that pattern for Phase 8.
      // But `injectContexContent` just gives text.
      // To prove caching, we need to send `cache_control`.

      // I will manually add `cache_control` here to demonstrate how a user *could* do it
      // if they weren't using the full wrapper, OR confirming that `injectContexContent` is just data delivery.

      // Actually, for the "Demo", using the high-level wrapper `createContexAnthropic` is probably better UX?
      // But the user specifically asked for `const tens = Tens.encode(data); ...`.

      // I will inject the text and manually add the cache breakpoint to the system prompt
      // to ensure caching happens.

      const systemBlock: any = {
        type: 'text',
        text: payload.text ? `Here is the data context:\n${payload.text}` : '',
        cache_control: { type: 'ephemeral' }, // Explicitly enable caching
      };

      const response = await client.messages.create({
        model,
        max_tokens: 100,
        system: [systemBlock], // Anthropic supports array for system
        messages: [{ role: 'user', content: 'Identify the top 3 P0 issues.' }],
      });

      // Log Usage
      // Anthropic usage response: { input_tokens: 123, output_tokens: 123, cache_creation_input_tokens: ..., cache_read_input_tokens: ... }
      const usage = response.usage as any;
      console.log(`   Input Tokens: ${usage.input_tokens}`);
      console.log(`   Output Tokens: ${usage.output_tokens}`);
      console.log(`   Cache Creation: ${usage.cache_creation_input_tokens || 0}`);
      console.log(`   Cache Read:     ${usage.cache_read_input_tokens || 0}`);

      return usage;
    });

    const elapsed = now() - start;
    console.log(`   Latency: ${elapsed.toFixed(0)}ms`);
    return elapsed;
  };

  // 4. Run Cold (First pass)
  // Expect: High latency, Cache Creation > 0, Cache Read = 0
  const time1 = await runInference('Run 1 (Cold)');

  // 5. Run Warm (Second pass)
  // Expect: Low latency, Cache Creation = 0, Cache Read > 0
  const time2 = await runInference('Run 2 (Warm)');

  // 6. Report
  console.log('\n--- Results ---');
  console.log(`Cold: ${time1.toFixed(0)}ms`);
  console.log(`Warm: ${time2.toFixed(0)}ms`);
  console.log(`Delta: ${(time1 - time2).toFixed(0)}ms`);

  if (time2 < time1 * 0.8) {
    console.log('✅ SUCCESS: Significant latency reduction observed.');
  } else {
    console.log(
      '⚠️ NOTE: Latency reduction not significant (network variance?). Check Cache Read tokens.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
