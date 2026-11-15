#!/usr/bin/env python3
"""Tailnet-bound range-aware static HTTP for private music audition artifacts.

Supports single byte-range GET/HEAD (206) for HTML5 media seeking. No public
listener; caller explicitly binds to the Tailscale IPv4 interface.
"""
import argparse
import os
import re
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class RangeHandler(SimpleHTTPRequestHandler):
	def end_headers(self):
		self.send_header("Accept-Ranges", "bytes")
		super().end_headers()

	def send_head(self):
		self._byte_range = None
		header = self.headers.get("Range")
		if not header:
			return super().send_head()
		path = self.translate_path(self.path)
		if not os.path.isfile(path):
			return super().send_head()
		match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
		if not match:
			return super().send_head()
		size = os.path.getsize(path)
		start_str, end_str = match.groups()
		if not start_str and not end_str:
			return super().send_head()
		if not start_str:
			count = int(end_str)
			start = max(0,size-count)
			end = size-1
		else:
			start = int(start_str)
			end = min(size-1,int(end_str)) if end_str else size-1
		if start >= size or start > end:
			self.send_response(416)
			self.send_header("Content-Range", "bytes */"+str(size))
			self.send_header("Content-Length","0")
			self.end_headers()
			return None
		file=open(path,"rb")
		file.seek(start)
		self._byte_range=(start,end)
		self.send_response(206)
		self.send_header("Content-Type",self.guess_type(path))
		self.send_header("Content-Range","bytes "+str(start)+"-"+str(end)+"/"+str(size))
		self.send_header("Content-Length",str(end-start+1))
		self.send_header("Cache-Control","private, max-age=3600")
		self.end_headers()
		return file

	def copyfile(self, source,output):
		if not self._byte_range:
			return super().copyfile(source,output)
		start,end=self._byte_range
		remaining=end-start+1
		while remaining:
			chunk=source.read(min(128*1024,remaining))
			if not chunk:break
			output.write(chunk)
			remaining-=len(chunk)

def main():
	p=argparse.ArgumentParser()
	p.add_argument("--bind",required=True)
	p.add_argument("--port",type=int,default=8182)
	p.add_argument("--directory",required=True)
	a=p.parse_args()
	handler=partial(RangeHandler,directory=a.directory)
	server=ThreadingHTTPServer((a.bind,a.port),handler)
	print("PRIVATE_RANGE_SERVER",a.bind,a.port,a.directory,flush=True)
	server.serve_forever()

if __name__=="__main__":
	main()
