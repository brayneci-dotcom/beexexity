# **Automated Multi-Step Prompt Refinement Agent**

## **📋 Current Situation**

You are building an **integrated AI inference application** that:
- Runs on **multiple local LLMs via AWS Bedrock**
- Implements an **automated prompt refinement gate** that converts raw user input into a structured format/framework
- Successfully detects and preserves the **original prompt language** (e.g., Bahasa Indonesia stays Indonesian)
- Ensures outputs are **concise and non-verbose**

**Example of what you've achieved:**
- Input: `"Buatkan email izin sakit"` → Output: Structured JSON with Indonesian content, concise fields

---

## **🎯 Problem to Solve**

You want to implement an **agentic workflow** that:
1. **Automatically processes prompts through multiple reasoning steps** (analyze → deconstruct → identify missing info → structure → draft → review)
2. **Performs internal "thought process"** 
3. **Still outputs concise, non-verbose results**
4. **Maintains language detection and preservation**
5. **Works efficiently with local LLMs via Bedrock**

**The Challenge:** How to get multi-step reasoning quality while keeping outputs short and showing the "thinking" process to end users for thought transparency?

---

## **💡 Three Possible Solutions**

### **Option 1: Single LLM Call with Hidden Chain-of-Thought**

**How it works:**
- Use **one LLM call** with instructions to perform multi-step reasoning **internally**
- The model thinks through all steps (analyze, structure, refine, review) but **only outputs the final concise JSON**
- Similar to how the refund email screenshots show thinking, but you suppress that output

**Implementation:**
```python
system_prompt = """
PROCESS INTERNALLY (do not show):
1. Analyze user request
2. Deconstruct source material  
3. Identify missing information
4. Structure the output
5. Draft and refine
6. Final review

OUTPUT ONLY: Final refined prompt in concise JSON format
"""
```

**✅ Pros:**
- **Fastest** - Single API call (~1-2 seconds)
- **Cheapest** - One model invocation
- **Simplest** - Minimal code, easy to maintain
- **Low latency** - Best for real-time user experience
- **Works well** with Claude 3 Sonnet/Haiku which follow instructions reliably

**❌ Cons:**
- **Less control** - Cannot inspect/modify intermediate steps
- **Harder to debug** - If output is wrong, don't know which step failed
- **Limited flexibility** - Cannot use different models for different steps
- **Token limits** - Complex reasoning might hit max_tokens
- **Quality ceiling** - Single pass may miss nuances that multi-step would catch

**Best for:** Simple to moderate complexity prompts, production apps where speed/cost matter most

---

### **Option 2: Multi-Step Workflow with LangGraph**

**How it works:**
- Use **LangGraph** (or similar orchestration framework) to create explicit state-based workflow
- Each step is a **separate LLM call**: analyze → structure → refine → finalize
- State is passed between steps, allowing inspection and modification
- Final step extracts only the concise output

**Implementation:**
```python
# Step 1: Analyze (Haiku - fast/cheap)
analysis = llm.invoke(f"Analyze: {user_input}")

# Step 2: Structure (Haiku - fast/cheap)  
structure = llm.invoke(f"Structure based on: {analysis}")

# Step 3: Refine (Sonnet - higher quality)
refined = final_llm.invoke(f"Refine using: {structure}")

# Step 4: Finalize (extract only JSON)
output = extract_json(refined)
```

**✅ Pros:**
- **Maximum control** - Can inspect/modify each step
- **Easy debugging** - See exactly where things go wrong
- **Model optimization** - Use cheap Haiku for early steps, powerful Sonnet for final
- **Human-in-the-loop** - Can add validation/approval gates between steps
- **Tool integration** - Can call external APIs, databases at specific steps
- **Conditional branching** - Different paths based on intermediate results
- **Best quality** - Multiple refinement passes catch errors

**❌ Cons:**
- **Slowest** - 4+ API calls (~5-10 seconds total)
- **Most expensive** - Multiple model invocations
- **Complex code** - State management, error handling, retries
- **Higher latency** - Poor UX for real-time apps
- **More failure points** - Each call can fail, need robust error handling
- **Overkill** - For simple prompts, this is unnecessary complexity

**Best for:** Complex enterprise workflows, applications requiring audit trails, scenarios needing human approval, when quality is more important than speed

---

### **Option 3: Hybrid Router + Skill-Based Processing**

**How it works:**
- **Router step**: Classify the request type (email, code, creative, analysis, general)
- **Skill-specific processors**: Each type has optimized prompts and constraints
- **2-3 API calls total**: (1) detect language + route, (2) specialized processing, (3) optional final polish
- Combines benefits of multi-step thinking with efficiency

**Implementation:**
```python
# Step 1: Route (fast)
skill = router.invoke(f"Classify: {user_input}")  # Returns: "email"

# Step 2: Process with specialized prompt
if skill == "email":
    result = email_skill.invoke(f"""
        Refine this email request. Be concise.
        Structure: greeting → body → call-to-action → closing
        {user_input}
    """)
elif skill == "code":
    result = code_skill.invoke(f"""
        Refine this coding request. Be concise.
        Include: language, framework, constraints
        {user_input}
    """)
```

**✅ Pros:**
- **Balanced** - Good speed (2-3 calls, ~2-4 seconds)
- **Cost-effective** - Fewer calls than full LangGraph
- **Specialized quality** - Email prompts get email-specific refinement, code gets code-specific
- **Moderate complexity** - Easier than LangGraph, more flexible than single call
- **Scalable** - Easy to add new skills without rewriting core logic
- **Maintainable** - Each skill is isolated, can update independently
- **Good UX** - Fast enough for real-time, smart enough for quality

**❌ Cons:**
- **Requires upfront work** - Must define skills and create specialized prompts
- **Routing errors** - If router misclassifies, wrong skill is used
- **Less granular control** - Can't inspect intermediate steps within a skill
- **Skill overlap** - Some requests might fit multiple categories
- **Maintenance overhead** - Each skill needs testing and optimization
- **Not as powerful as LangGraph** - Cannot do complex conditional workflows

**Best for:** Production apps with diverse prompt types, when you need better quality than single-call but faster than full multi-step, most real-world use cases

---

## **📊 Comparison Table**

| Feature | Option 1: Single Call | Option 2: LangGraph | Option 3: Hybrid Router |
|---------|----------------------|---------------------|------------------------|
| **Speed** | ⚡⚡⚡ Fastest (1-2s) | 🐌 Slowest (5-10s) | ⚡⚡ Medium (2-4s) |
| **Cost** | 💰 Cheapest | 💰💰💰 Most expensive | 💰💰 Moderate |
| **Quality** | ⭐⭐ Good | ⭐⭐⭐⭐⭐ Best | ⭐⭐⭐⭐ Very Good |
| **Complexity** | 🔧 Simple | 🔧🔧 Complex | 🔧 Moderate |
| **Control** | 🔒 Low | 🔓 Full control | 🔓🔓 Partial control |
| **Debuggability** | 🔍 Hard | 🔍🔍 Easy | 🔍🔍 Moderate |
| **Scalability** | ⚠️ Limited | ✅ Excellent | ✅ Good |
| **Best Use Case** | Simple prompts, speed-critical | Enterprise workflows, audit trails | Diverse prompt types, balanced needs |




Based on the screenshots and search results, you want to implement an **agentic workflow** that performs multi-step reasoning internally but outputs concise results. Here are three implementation approaches:

## **Approach 1: Single LLM Call with Hidden Chain-of-Thought** (Simplest)

Keep the detailed thinking internal to one LLM call, then extract only the final result:

```python
import boto3
import json
import re

class PromptRefinementAgent:
    def __init__(self, model_id="anthropic.claude-3-sonnet-20240229-v1:0"):
        self.bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')
        self.model_id = model_id
    
    def refine_prompt(self, user_input: str) -> dict:
        system_prompt = """You are an expert prompt refinement agent. 

PROCESS (do this internally):
1. Analyze the user's request - identify goal, language, context
2. Deconstruct the source material - extract key elements
3. Identify missing information - what needs clarification
4. Structure the refined output - plan the structure
5. Draft and refine - iterate for clarity and conciseness
6. Final review - ensure it matches requirements

OUTPUT RULES:
- Perform all reasoning internally
- Output ONLY the final refined prompt in this JSON format:
{
  "detected_language": "<code>",
  "refined_prompt": {
    "role": "<max 5 words>",
    "context": "<max 15 words>",
    "task": "<max 15 words>",
    "constraints": ["<short item 1>", "<short item 2>"],
    "output_format": "<max 10 words>"
  }
}

EXAMPLE:
Input: "Buatkan email izin sakit"
Output:
{
  "detected_language": "id",
  "refined_prompt": {
    "role": "Karyawan profesional",
    "context": "Sedang sakit, tidak bisa masuk kerja",
    "task": "Tulis email izin sakit singkat dan sopan",
    "constraints": ["Maksimal 3 kalimat", "Sebutkan tetap cek email"],
    "output_format": "Teks email siap kirim"
  }
}"""

        response = self.bedrock.invoke_model(
            modelId=self.model_id,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,
                "temperature": 0.1,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_input}]
            })
        )
        
        result = json.loads(response['body'].read())
        return json.loads(result['content'][0]['text'])
```

**Pros:** Simple, fast, one API call  
**Cons:** Less control over intermediate steps

---

## **Approach 2: Multi-Step Workflow with LangGraph** (Most Control)

Use LangGraph for explicit step-by-step processing with state management [[5]][[7]]:

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
from langchain_aws import ChatBedrock
import operator

# Define state structure
class AgentState(TypedDict):
    user_input: str
    analysis: dict
    structure: dict
    refined_prompt: dict
    final_output: dict

class MultiStepRefinementAgent:
    def __init__(self):
        self.llm = ChatBedrock(
            model_id="anthropic.claude-3-haiku-20240307-v1:0",  # Fast, cheap for intermediate steps
            temperature=0.1
        )
        self.final_llm = ChatBedrock(
            model_id="anthropic.claude-3-sonnet-20240229-v1:0",  # Better quality for final output
            temperature=0.1
        )
        self.graph = self._build_graph()
    
    def _build_graph(self):
        workflow = StateGraph(AgentState)
        
        # Add nodes for each step
        workflow.add_node("analyze", self._analyze_request)
        workflow.add_node("structure", self._create_structure)
        workflow.add_node("refine", self._refine_prompt)
        workflow.add_node("finalize", self._finalize_output)
        
        # Define edges (flow)
        workflow.set_entry_point("analyze")
        workflow.add_edge("analyze", "structure")
        workflow.add_edge("structure", "refine")
        workflow.add_edge("refine", "finalize")
        workflow.add_edge("finalize", END)
        
        return workflow.compile()
    
    def _analyze_request(self, state: AgentState) -> dict:
        """Step 1: Analyze user request"""
        prompt = f"""Analyze this request. Return JSON:
{{
  "goal": "<what user wants>",
  "language": "<detect language code>",
  "key_elements": ["<element1>", "<element2>"],
  "implied_needs": ["<need1>", "<need2>"]
}}

Request: {state['user_input']}"""
        
        result = self.llm.invoke(prompt)
        return {"analysis": json.loads(result.content)}
    
    def _create_structure(self, state: AgentState) -> dict:
        """Step 2: Create structure plan"""
        prompt = f"""Based on this analysis: {state['analysis']}
Create a structure plan. Return JSON:
{{
  "sections": ["<section1>", "<section2>"],
  "format": "<output format>",
  "tone": "<professional/casual/etc>"
}}"""
        
        result = self.llm.invoke(prompt)
        return {"structure": json.loads(result.content)}
    
    def _refine_prompt(self, state: AgentState) -> dict:
        """Step 3: Generate refined prompt"""
        prompt = f"""Using this analysis and structure:
Analysis: {state['analysis']}
Structure: {state['structure']}

Create a refined prompt in {state['analysis']['language']}. 
Keep it concise. Return JSON:
{{
  "role": "<max 5 words>",
  "context": "<max 15 words>",
  "task": "<max 15 words>",
  "constraints": ["<item1>", "<item2>"],
  "output_format": "<max 10 words>"
}}"""
        
        result = self.final_llm.invoke(prompt)
        return {"refined_prompt": json.loads(result.content)}
    
    def _finalize_output(self, state: AgentState) -> dict:
        """Step 4: Final review and formatting"""
        # Optional: Add validation/enforcement step
        return {"final_output": state['refined_prompt']}
    
    def process(self, user_input: str) -> dict:
        initial_state = {
            "user_input": user_input,
            "analysis": {},
            "structure": {},
            "refined_prompt": {},
            "final_output": {}
        }
        
        result = self.graph.invoke(initial_state)
        return result['final_output']
```

**Pros:** Full control, debuggable steps, can use different models per step [[11]]  
**Cons:** More complex, multiple API calls (higher latency/cost)

---

## **Approach 3: Hybrid Router + Skill-Based Processing** (Best Balance)

Use a router to determine the type of task, then apply specialized processing [[15]][[16]]:

```python
class SkillBasedAgent:
    def __init__(self):
        self.bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')
        self.skills = {
            "email": self._process_email,
            "code": self._process_code,
            "creative": self._process_creative,
            "analysis": self._process_analysis,
            "general": self._process_general
        }
    
    def _route_request(self, user_input: str) -> str:
        """Determine which skill to use"""
        router_prompt = f"""Classify this request into ONE category:
        Categories: email, code, creative, analysis, general
        
        Request: {user_input}
        
        Return ONLY the category name."""
        
        response = self.bedrock.invoke_model(
            modelId="anthropic.claude-3-haiku-20240307-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 50,
                "temperature": 0,
                "messages": [{"role": "user", "content": router_prompt}]
            })
        )
        
        skill = json.loads(response['body'].read())['content'][0]['text'].strip().lower()
        return skill if skill in self.skills else "general"
    
    def _process_email(self, user_input: str, language: str) -> dict:
        """Specialized email refinement"""
        prompt = f"""Refine this email request in {language}. Be concise.
        
        Process:
        1. Identify: sender, recipient, purpose, tone
        2. Extract key points
        3. Structure: greeting, body, call-to-action, closing
        
        Return ONLY this JSON:
        {{
          "detected_language": "{language}",
          "refined_prompt": {{
            "role": "Professional email writer",
            "context": "<max 15 words>",
            "task": "Write <type> email to <recipient>",
            "constraints": ["<max 3 items>"],
            "output_format": "Complete email text"
          }}
        }}
        
        Request: {user_input}"""
        
        return self._call_llm(prompt)
    
    def _process_code(self, user_input: str, language: str) -> dict:
        """Specialized code refinement"""
        prompt = f"""Refine this coding request in {language}. Be concise.
        
        Return ONLY this JSON:
        {{
          "detected_language": "{language}",
          "refined_prompt": {{
            "role": "Expert <language> developer",
            "context": "<max 15 words>",
            "task": "Write code to <specific task>",
            "constraints": ["<max 3 technical constraints>"],
            "output_format": "Code with brief explanation"
          }}
        }}
        
        Request: {user_input}"""
        
        return self._call_llm(prompt)
    
    # Add other skill methods...
    
    def _process_general(self, user_input: str, language: str) -> dict:
        """General purpose refinement"""
        prompt = f"""Refine this request in {language}. Be concise.
        
        Return ONLY this JSON:
        {{
          "detected_language": "{language}",
          "refined_prompt": {{
            "role": "Expert assistant",
            "context": "<max 15 words>",
            "task": "<max 15 words>",
            "constraints": ["<max 3 items>"],
            "output_format": "<max 10 words>"
          }}
        }}
        
        Request: {user_input}"""
        
        return self._call_llm(prompt)
    
    def _call_llm(self, prompt: str) -> dict:
        response = self.bedrock.invoke_model(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 800,
                "temperature": 0.1,
                "messages": [{"role": "user", "content": prompt}]
            })
        )
        
        result = json.loads(response['body'].read())
        return json.loads(result['content'][0]['text'])
    
    def process(self, user_input: str) -> dict:
        # Step 1: Detect language (fast model)
        lang_response = self.bedrock.invoke_model(
            modelId="anthropic.claude-3-haiku-20240307-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 50,
                "temperature": 0,
                "messages": [{"role": "user", "content": f"Detect language of: {user_input}. Return ISO code only."}]
            })
        )
        language = lang_response['body'].read().decode().strip()
        
        # Step 2: Route to appropriate skill
        skill = self._route_request(user_input)
        
        # Step 3: Process with specialized skill
        result = self.skills[skill](user_input, language)
        
        return result
```

**Pros:** Balanced complexity, specialized processing, efficient routing [[16]]  
**Cons:** Requires defining skills upfront

---

