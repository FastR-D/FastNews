"""Offline FastNews account provisioning; generated credentials are shown once."""
import argparse
import getpass
import json
import os

from fastnews_accounts import Accounts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['create','invite','recovery'])
    parser.add_argument('--root', default=os.environ.get('FASTNEWS_DATA_DIR', '.fastnews-data'))
    parser.add_argument('--email', required=True)
    parser.add_argument('--name', default='')
    args = parser.parse_args()
    accounts = Accounts(args.root)
    if args.action == 'create':
        password = os.environ.get('FASTNEWS_INITIAL_PASSWORD') or getpass.getpass('Initial password: ')
        print(json.dumps({'user_id':accounts.create(args.email,password,args.name)}))
    else:
        print(json.dumps({'kind':args.action,'token':accounts.issue(args.action,args.email),'expires_in':3600}))


if __name__ == '__main__':
    main()
