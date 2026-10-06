import asyncio
from typing import Dict, Set, Any, AsyncGenerator
from collections import defaultdict
import json

class EventBus:
    def __init__(self):
        # run_id -> set of asyncio.Queue
        self.subscribers: Dict[str, Set[asyncio.Queue]] = defaultdict(set)
    
    async def subscribe(self, run_id: str) -> AsyncGenerator[str, None]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        self.subscribers[run_id].add(queue)
        try:
            while True:
                msg = await queue.get()
                yield msg
        except asyncio.CancelledError:
            raise
        finally:
            self.subscribers[run_id].discard(queue)
            if not self.subscribers[run_id]:
                self.subscribers.pop(run_id, None)

    def publish(self, run_id: str, event_name: str, data: Any):
        if run_id not in self.subscribers:
            return
            
        # Format SSE message
        if isinstance(data, dict):
            # dict, assume we want to dump it
            json_data = json.dumps(data)
        elif isinstance(data, str):
            json_data = data
        else:
            # Pydantic models or similar should be handled before or here
            json_data = data.model_dump_json(by_alias=True) if hasattr(data, "model_dump_json") else json.dumps(data)
            
        message = f"event: {event_name}\ndata: {json_data}\n\n"
        
        for queue in list(self.subscribers[run_id]):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass  # Evict or drop if subscriber queue is full

# Global singleton
event_bus = EventBus()
