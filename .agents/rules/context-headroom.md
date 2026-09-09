---
description: >-
  Preserve context-window headroom for quality and cost. Load only what the task
  needs and keep a buffer of unused tokens.
---

To ensure optimal performance and cost-effectiveness when utilizing LLMs, follow these guidelines:

1. **Load Only Necessary Context**: When preparing input for the LLM, include only the tokens that are essential for the task at hand. Avoid unnecessary verbosity that could consume valuable context window space.

2. **Maintain a Buffer**: Always keep a buffer of unused tokens within the context window. This buffer should be a minimum of 10-15% of the total context window size to allow for flexibility and adaptability in responses.

3. **Dynamic Context Management**: Regularly assess the context being loaded and adjust it dynamically based on the task requirements. Use the `llm-output-safety` rule to ensure that the output remains within safe operational parameters.

4. **Cost Monitoring**: Be mindful of the cost implications of context usage. Loading excessive context can lead to higher operational costs, so always strive to optimize the balance between context richness and cost efficiency.

Following these guidelines will help maintain a high-quality interaction with LLMs while managing costs effectively. 

Related rules: `llm-output-safety`, `llm-security`.
