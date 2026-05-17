from setuptools import setup, find_packages

setup(
    name='ananke',
    version='0.1.0',
    description='Python SDK for the Ananke Quant Trading Platform',
    author='Arun Thegiri',
    packages=find_packages(),
    python_requires='>=3.9',
    install_requires=[
        'pandas>=1.5.0',
        'numpy>=1.23.0',
        'matplotlib>=3.6.0',
        'requests>=2.28.0',
        'sqlalchemy>=2.0.0',
        'psycopg2-binary>=2.9.0',
    ],
)
